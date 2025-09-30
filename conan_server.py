#!/usr/bin/env python3
"""
FastAPI server for Conan VS Code extension.
This server provides REST API endpoints for Conan operations.
"""

import os
import sys
import argparse
from typing import List, Optional, Dict
from pathlib import Path
from contextlib import asynccontextmanager

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
    import uvicorn
except ImportError:
    print("ERROR: FastAPI dependencies not found. Install with: pip install fastapi uvicorn")
    sys.exit(1)

# Import Conan Python API
try:
    from conan.api.conan_api import ConanAPI
    from conan.errors import ConanException
    from conan.api.model import ListPattern, RecipeReference, PkgReference, Remote
    from conan.internal.loader import load_python_file
    from conan.internal.graph.profile_node_definer import initialize_conanfile_profile
    from conan.internal.graph.graph import Node
    from conan.internal.graph.graph import CONTEXT_BUILD
    from conan.internal.graph.graph import BINARY_BUILD, BINARY_CACHE, BINARY_DOWNLOAD, BINARY_INVALID
    from conan.internal.graph.graph import RECIPE_DOWNLOADED, RECIPE_INCACHE, RECIPE_UPDATED
    from conan.internal.model.settings import load_settings_yml
except ImportError:
    print("ERROR: Conan Python API not found. Make sure Conan 2.x is installed.")
    sys.exit(1)

# Import local utilities
from conan_utils import is_authenticated

# Global variables
conan_api: Optional[ConanAPI] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler for FastAPI application."""
    # Startup
    global conan_api
    try:
        conan_api = ConanAPI()
        print("Conan API initialized successfully")
    except Exception as e:
        print(f"Failed to initialize Conan API: {e}")
        conan_api = None

    yield

    # Shutdown
    # Add any cleanup code here if needed
    pass

app = FastAPI(
    title="Conan VS Code Extension API",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConanSettings(BaseModel):
    """Conan settings structure."""
    path: str                           # Path to settings file in home folder

    os: Dict[str, dict] = {}            # e.g., {"Windows": {}, "Linux": {}}
    arch: List[str] = []                # e.g., ["x86_64", "armv8"]

    # e.g., {"gcc": {"version": ["9", "10"], "libcxx": ["libstdc++11"]}, "clang": {...}}
    compiler: Dict[str, dict] = {}
    build_type: List[str | None] = []   # e.g., ["Debug", "Release"]


class PackageAvailability(BaseModel):
    """Package availability information based on what Conan's analyze_binaries tells us."""

    is_incompatible: bool = False
    incompatible_reason: Optional[str] = None

    # Local availability
    local_status: str = "none"
    remote_status: str = "none"


class ConanPackage(BaseModel):
    name: str
    version: str
    ref: str
    availability: PackageAvailability
    # Add support for nested dependencies
    dependencies: List['ConanPackage'] = []


class ConanProfile(BaseModel):
    name: str
    path: str
    isLocal: bool = False


class ConanRemote(BaseModel):
    name: str
    url: str
    verify_ssl: bool = True


class UploadRequest(BaseModel):
    remote_name: str
    packages: List[str]
    host_profile: str
    build_profile: str
    force: bool = False


class UploadLocalRequest(BaseModel):
    remote_name: str
    package_ref: str
    host_profile: str
    force: bool = False


class InstallRequest(BaseModel):
    build_missing: bool = True
    host_profile: str
    build_profile: str


class InstallPackageRequest(BaseModel):
    package_ref: str
    build_missing: bool = True
    host_profile: str
    build_profile: str
    force: bool = False


class ProfileCreateRequest(BaseModel):
    name: str
    detect: bool = True
    settings: Dict[str, str] = {}
    profiles_path: Optional[str] = None  # Path to local profiles directory


class RemoteAddRequest(BaseModel):
    name: str
    url: str
    verify_ssl: bool = True


# Global variables
conan_api: Optional[ConanAPI] = None


@app.get("/")
async def root():
    """Root endpoint to check if server is running."""
    return {"message": "Conan VS Code Extension API Server", "status": "running"}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
    }


def find_conanfile() -> str:
    """
    Find conanfile in current working directory.

    Returns:
        Path to the found conanfile (conanfile.txt or conanfile.py)

    Raises:
        HTTPException: If no conanfile is found
    """
    conanfile_txt = "conanfile.txt"
    conanfile_py = "conanfile.py"

    if os.path.exists(conanfile_txt):
        return os.path.abspath(conanfile_txt)
    elif os.path.exists(conanfile_py):
        return os.path.abspath(conanfile_py)
    else:
        raise HTTPException(
            status_code=404, detail="No conanfile found in current directory")


@app.get("/packages")
async def get_packages(host_profile: str, build_profile: str, remote: Optional[str] = None) -> List[ConanPackage]:
    """
    Get packages from conanfile in current workspace.

    Args:
        host_profile: Host profile name (required)
        build_profile: Build profile name (required)
        remote: Specific remote to check. If None, checks all configured remotes (optional)

    Returns:
        List of packages with their availability status across local cache and remote(s)
    """
    try:
        conanfile_path = find_conanfile()

        packages = await parse_conanfile(conanfile_path, host_profile, build_profile, remote)

        return packages
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error parsing conanfile: {str(e)}")


def create_package_from_node(node: Node, remotes: List[Remote]) -> ConanPackage:

    # Extract what Conan tells us
    recipe_status = str(
        node.recipe) if node.recipe else "unknown"
    binary_status = str(
        node.binary) if node.binary else "unknown"

    # Determine simple flags for UI
    local_recipe_available = recipe_status == RECIPE_INCACHE
    local_binary_available = binary_status == BINARY_CACHE

    local_status = "none"
    if local_recipe_available:
        local_status = "recipe"
        if local_binary_available:
            local_status = "recipe+binary"

    is_incompatible = binary_status == BINARY_INVALID
    incompatible_reason = node.conanfile.info.invalid if is_incompatible else None

    # Enhanced remote checking: if package is in local cache, also check remote availability
    remote_recipe_available = False
    remote_binary_available = False

    remote_status = 'none'

    try:
        # Check each configured remote
        for remote in remotes:
            # Check if package exists for this recipe reference
            try:
                recipe_ref: RecipeReference = RecipeReference(
                    node.ref.name,
                    node.ref.version,
                    node.ref.user,
                    node.ref.channel
                )

                recipe_revisions = conan_api.list.recipe_revisions(
                    recipe_ref, remote)
                if recipe_revisions:
                    remote_recipe_available = True
            except Exception as e:
                print(
                    f"Error checking remote availability for recipe {recipe_ref}: {e}")
                pass  # Binary not found on this remote, try next

            # Check if binary exists for this package ID
            try:
                package_ref: PkgReference = PkgReference(
                    node.ref, node.package_id)
                package_revisions = conan_api.list.package_revisions(
                    package_ref, remote)
                if package_revisions:
                    remote_binary_available = True
            except Exception as e:
                print(
                    f"Error checking remote availability for package {package_ref}: {e}")
                pass  # Binary not found on this remote, try next

            if remote_recipe_available:
                remote_status = "recipe"
                if remote_binary_available:
                    remote_status = "recipe+binary"

    except Exception as e:
        print(
            f"Error checking remote availability for {node.ref}: {e}")

    dependencies: List[ConanPackage] = []
    for edge in node.edges:
        package = create_package_from_node(edge.dst, remotes)
        dependencies.append(package)

    availability = PackageAvailability(
        is_incompatible=is_incompatible,
        incompatible_reason=incompatible_reason,
        local_status=local_status,
        remote_status=remote_status
    )

    package = ConanPackage(
        name=node.ref.name,
        version=str(node.ref.version),
        ref=str(node.ref),
        dependencies=dependencies,
        availability=availability
    )

    return package

async def parse_conanfile(file_path: str, host_profile: str, build_profile: str, remote_name: Optional[str] = None) -> List[ConanPackage]:
    """Parse conanfile.py and extract packages with optional remote filtering."""
    packages: List[ConanPackage] = []

    try:
        # Load the specified profiles
        profile_host = conan_api.profiles.get_profile(
            [host_profile], {}, {}, {}, None)
        profile_build = conan_api.profiles.get_profile(
            [build_profile], {}, {}, {}, None)

        # Set up remotes to check
        remotes: List[Remote] = []
        if not remote_name:
            remotes = conan_api.remotes.list()
        else:
            try:
                specific_remote = conan_api.remotes.get(remote_name)
                remotes.append(specific_remote)
                # Always include conancenter as fallback unless it's already the specified remote
                if remote_name != "conancenter":
                    try:
                        conancenter = conan_api.remotes.get('conancenter')
                        remotes.append(conancenter)
                    except:
                        pass  # conancenter might not be configured
            except Exception as e:
                print(f"Failed to get remote {remote_name}: {e}")
                return PackageAvailability(
                    recipe_status="error",
                    binary_status="error"
                )

        # Remove the remotes that are not authenticated
        for remote in remotes[:]:  # Copy the list to avoid modification during iteration
            if not is_authenticated(conan_api, remote):
                print(f"Not authenticated to remote {remote.name}")
                remotes.remove(remote)
                
        root_node = conan_api.graph.load_graph_consumer(
            file_path, None, None, None, None, profile_host, profile_build, None, remotes=remotes, update=None
        )

        for dep, edge in root_node.root.transitive_deps.items():

            try:
                # Create a dependency graph for this specific package requirement
                deps_graph = conan_api.graph.load_graph_requires(
                    requires=[dep.ref],
                    tool_requires=None,
                    profile_host=profile_host,
                    profile_build=profile_build,
                    lockfile=None,
                    remotes=remotes,
                    update=["*"]
                )

                if deps_graph.error:
                    availability = PackageAvailability(
                        is_incompatible=True,
                        incompatible_reason=str(deps_graph.error),
                        local_status="none",
                        remote_status="none"
                    )

                    package = ConanPackage(
                        name=dep.ref.name,
                        version=str(dep.ref.version),
                        ref=str(dep.ref),
                        availability=availability
                    )
                    packages.append(package)

                # Analyze binaries to see what's available
                conan_api.graph.analyze_binaries(
                    deps_graph,
                    # Don't build anything, just analyze what exists
                    build_mode=['never'],
                    remotes=remotes,
                    update=None,
                    lockfile=None,
                    build_modes_test=None,
                    tested_graph=None
                )

                for edge in deps_graph.root.edges:
                    package = create_package_from_node(edge.dst, remotes)
                    packages.append(package)

            except Exception as e:
                print(f"Error analyzing package {dep.ref}: {e}")

        return packages
    except Exception as e:
        print(f"Error parsing conanfile: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error parsing conanfile: {str(e)}")


@app.get("/profiles")
async def get_profiles(local_profiles_path: Optional[str] = None) -> List[ConanProfile]:
    """Get available Conan profiles."""
    if not conan_api:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:
        profiles = []

        # Get global profiles from Conan
        profile_names = conan_api.profiles.list()
        for profile_name in profile_names:
            try:
                profile_path = conan_api.profiles.get_path(profile_name)
                profiles.append(ConanProfile(
                    name=profile_name,
                    path=profile_path,
                    isLocal=False
                ))
            except Exception as e:
                print(f"Error processing global profile {profile_name}: {e}")
                continue

        # Get local profiles if path is specified
        if local_profiles_path:
            try:
                # Convert relative path to absolute
                if not os.path.isabs(local_profiles_path):
                    local_profiles_path = os.path.abspath(local_profiles_path)

                if os.path.exists(local_profiles_path) and os.path.isdir(local_profiles_path):
                    for filename in os.listdir(local_profiles_path):
                        filepath = os.path.join(local_profiles_path, filename)
                        if os.path.isfile(filepath) and not filename.startswith('.'):
                            profiles.append(ConanProfile(
                                name=filename,
                                path=filepath,
                                isLocal=True
                            ))
            except Exception as e:
                print(f"Error scanning local profiles directory: {e}")

        return profiles
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error getting profiles: {str(e)}")


@app.get("/remotes")
async def get_remotes() -> List[ConanRemote]:
    """Get configured Conan remotes."""
    if not conan_api:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:
        remotes_list = conan_api.remotes.list()
        remotes = []

        for remote in remotes_list:
            remotes.append(ConanRemote(
                name=remote.name,
                url=remote.url,
                verify_ssl=remote.verify_ssl
            ))

        return remotes
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error getting remotes: {str(e)}")


@app.post("/install")
async def install_packages(request: InstallRequest):
    """Install packages from conanfile."""
    if not conan_api:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:
        conanfile_path = find_conanfile()

        # Get profiles
        profile_host = conan_api.profiles.get_profile(
            [request.host_profile], {}, {}, {}, None)
        profile_build = conan_api.profiles.get_profile(
            [request.build_profile], {}, {}, {}, None)

        # Get remotes
        remotes = conan_api.remotes.list()

        # Create dependency graph
        deps_graph = conan_api.graph.load_graph_consumer(
            path=conanfile_path,
            name=None, version=None, user=None, channel=None,
            profile_host=profile_host,
            profile_build=profile_build,
            lockfile=None,
            remotes=remotes,
            update=["*"] if request.build_missing else None
        )

        # Analyze binaries and determine what to build
        build_mode = ["missing"] if request.build_missing else None
        conan_api.graph.analyze_binaries(
            deps_graph,
            build_mode=build_mode,
            remotes=remotes,
            update=["*"] if request.build_missing else None,
            lockfile=None,
            build_modes_test=None,
            tested_graph=None
        )

        # Install binaries
        conan_api.install.install_binaries(
            deps_graph=deps_graph, remotes=remotes)

        return {
            "message": f"Package installation completed with profiles: host={request.host_profile}, build={request.build_profile}",
            "status": "completed"
        }
    except HTTPException:
        raise  # Re-raise HTTP exceptions from find_conanfile
    except ConanException as e:
        raise HTTPException(
            status_code=500, detail=f"Conan API error: {str(e)}")
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error during installation: {str(e)}")


@app.post("/install/package")
async def install_package(request: InstallPackageRequest):
    """Install a specific package by reference."""

    if not conan_api:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:
        # Get profiles
        profile_host = conan_api.profiles.get_profile(
            [request.host_profile], {}, {}, {}, None)
        profile_build = conan_api.profiles.get_profile(
            [request.build_profile], {}, {}, {}, None)

        # Get remotes
        remotes = conan_api.remotes.list()

        # Create dependency graph for specific package
        deps_graph = conan_api.graph.load_graph_requires(
            requires=[request.package_ref],
            tool_requires=None,
            profile_host=profile_host,
            profile_build=profile_build,
            lockfile=None,
            remotes=remotes,
            update=["*"]
        )

        # Analyze binaries and determine what to build
        build_mode = ["missing"] if request.build_missing else None
        conan_api.graph.analyze_binaries(
            deps_graph,
            build_mode=build_mode,
            remotes=remotes,
            update=["*"],
            lockfile=None,
            build_modes_test=None,
            tested_graph=None
        )

        # Install binaries
        conan_api.install.install_binaries(
            deps_graph=deps_graph, remotes=remotes)

        return {
            "message": f"Installation of package {request.package_ref} completed with profiles: host={request.host_profile}, build={request.build_profile}",
            "status": "completed"
        }
    except ConanException as e:
        raise HTTPException(
            status_code=500, detail=f"Conan API error: {str(e)}")
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error during package installation: {str(e)}")


@app.post("/profiles/create")
async def create_profile(request: ProfileCreateRequest):
    """Create a new Conan profile."""
    if not conan_api:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:
        # Determine the profiles directory path
        if request.profiles_path:
            # Use local profiles path
            if not os.path.isabs(request.profiles_path):
                profiles_path = os.path.abspath(request.profiles_path)
            else:
                profiles_path = request.profiles_path
        else:
            # Use global profiles path
            profiles_path = os.path.join(conan_api.config.home(), "profiles")

        os.makedirs(profiles_path, exist_ok=True)
        profile_file_path = os.path.join(profiles_path, request.name)

        # Create profile content
        profile_content = []

        if request.detect and not request.settings:
            # Auto-detect settings for the profile
            try:
                from conan.internal.api.detect import detect_api
                detected_settings = detect_api(conan_api)

                # Convert detected settings to profile format
                profile_content.append("[settings]")
                for key, value in detected_settings.items():
                    if value is not None:
                        profile_content.append(f"{key}={value}")
            except Exception as e:
                print(f"Error auto-detecting settings: {e}")
                # Fall back to basic profile creation
                profile_content.append("[settings]")
        else:
            # Use provided settings
            profile_content.append("[settings]")
            for key, value in request.settings.items():
                if value is not None:
                    profile_content.append(f"{key}={value}")

        # Add empty sections for completeness
        profile_content.extend([
            "",
            "[options]",
            "",
            "[tool_requires]",
            "",
            "[conf]"
        ])

        # Write profile to file
        with open(profile_file_path, 'w') as f:
            f.write('\n'.join(profile_content))

        return {"message": f"Profile '{request.name}' created successfully", "path": profile_file_path}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error creating profile: {str(e)}")


@app.post("/remotes/add")
async def add_remote(request: RemoteAddRequest):
    """Add a new Conan remote."""
    if not conan_api:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:
        # Use Conan API to add remote
        from conan.api.model import Remote

        # Create a new remote object
        new_remote = Remote(request.name, request.url, request.verify_ssl)

        # Add the remote using the API
        conan_api.remotes.add(new_remote)

        return {"message": f"Remote '{request.name}' added successfully", "url": request.url}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error adding remote: {str(e)}")


@app.post("/upload/missing")
async def upload_missing_packages(request: UploadRequest):
    """Upload missing packages to remote (synchronous)."""
    if not conan_api:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:
        # Execute upload synchronously
        result = await upload_packages_task(request)
        return {"message": "Package upload completed", "status": "completed", "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


async def upload_packages_task(request: UploadRequest):
    """Background task to upload packages."""
    try:
        conanfile_path = find_conanfile()

        # Only support conanfile.py for uploads
        if conanfile_path != "conanfile.py":
            raise Exception(
                "Only conanfile.py is supported for uploads, conanfile.txt found")

        # Load conanfile and get dependencies
        module, _ = load_python_file(conanfile_path)

        # Find the ConanFile class defined in the module
        conanfile_class = None
        for attr in dir(module):
            obj = getattr(module, attr)
            if isinstance(obj, type) and issubclass(obj, module.ConanFile) and obj.__name__ != "ConanFile":
                conanfile_class = obj
                break

        if not conanfile_class:
            raise Exception("No ConanFile class found")

        # Get remote
        remote = conan_api.remotes.get(request.remote_name)
        remotes = conan_api.remotes.list()

        # Process each package
        conanfile = conanfile_class()

        # Load specified profiles
        try:
            profile_host = conan_api.profiles.get_profile(
                [request.host_profile], {}, {}, {}, None)
            profile_build = conan_api.profiles.get_profile(
                [request.build_profile], {}, {}, {}, None)
        except Exception as e:
            print(f"Error loading profiles: {e}")
            raise Exception(
                f"Failed to load profiles: host={request.host_profile}, build={request.build_profile}")

        initialize_conanfile_profile(conanfile, profile_build=profile_build,
                                     profile_host=profile_host, base_context=CONTEXT_BUILD, is_build_require=False)

        # Call requirements to populate .requires
        if hasattr(conanfile, 'requirements'):
            conanfile.requirements()

        if hasattr(conanfile, 'requires'):
            for r in conanfile.requires.values():
                print(f"Processing package: {r.ref}")

                try:
                    ref_pattern = ListPattern(str(r.ref), package_id="*")
                    package_list = conan_api.list.select(
                        ref_pattern, profile=profile_host)

                    if package_list.recipes:
                        print(f"Uploading {r.ref}")
                        conan_api.upload.upload_full(
                            package_list, remote, remotes, dry_run=False)
                        print(f"Successfully uploaded {r.ref}")
                except ConanException as e:
                    print(f"Failed to upload {r.ref}: {e}")
                except Exception as e:
                    print(f"Unexpected error uploading {r.ref}: {e}")

        return {"message": "All packages processed", "status": "completed"}

    except Exception as e:
        print(f"Upload task failed: {e}")
        raise Exception(f"Upload task failed: {e}")


@app.post("/upload/local")
async def upload_local_package(request: UploadLocalRequest):
    """Upload a specific local package to remote (synchronous)."""
    if not conan_api:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:
        # Get the remote
        remote = conan_api.remotes.get(request.remote_name)
        remotes = conan_api.remotes.list()

        # Check if package exists locally first
        try:
            from conan.api.model import ListPattern
            ref_pattern = ListPattern(request.package_ref, package_id="*")

            # Get specified profiles for listing
            try:
                profile_host = conan_api.profiles.get_profile(
                    [request.host_profile], {}, {}, {}, None)
            except Exception as e:
                raise HTTPException(
                    status_code=400, detail=f"Failed to load host profile '{request.host_profile}': {str(e)}")

            package_list = conan_api.list.select(
                ref_pattern, profile=profile_host)

            if not package_list.recipes:
                raise HTTPException(
                    status_code=404, detail=f"Package {request.package_ref} not found in local cache")

            # Upload the package
            print(f"Uploading {request.package_ref} to {request.remote_name}")
            conan_api.upload.upload_full(
                package_list, remote, remotes, dry_run=False)

            return {
                "message": f"Successfully uploaded {request.package_ref} to {request.remote_name}",
                "status": "completed"
            }

        except ConanException as e:
            raise HTTPException(
                status_code=500, detail=f"Conan API error: {str(e)}")

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error uploading package: {str(e)}")


@app.get("/settings")
async def get_settings() -> ConanSettings:
    """Get available Conan settings from settings.yml."""
    if not conan_api:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:
        # Get Conan home folder
        home_folder = conan_api.config.home()

        # Load settings using load_settings_yml
        settings_obj = load_settings_yml(home_folder)

        # Get the settings path for the response
        from conan.internal.cache.home_paths import HomePaths
        home_paths = HomePaths(home_folder)
        settings_path = home_paths.settings_path

        # Extract settings structure from the loaded Settings object
        possible_values = settings_obj.possible_values()

        # Convert to ConanSettings format
        conan_settings = ConanSettings(
            path=settings_path,
            os=possible_values.get("os", {}),
            arch=list(possible_values.get("arch", [])),
            compiler=possible_values.get("compiler", {}),
            build_type=list(possible_values.get("build_type", []))
        )

        return conan_settings

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error loading settings: {str(e)}")


@app.get("/config/home")
async def get_conan_home():
    """Get Conan home directory path."""
    if not conan_api:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:
        home_folder = conan_api.config.home()
        return home_folder
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error getting Conan home: {str(e)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Conan VS Code Extension API Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=0,
                        help="Port to bind to (0 for any available port)")

    args = parser.parse_args()

    # If port is 0, let uvicorn choose an available port
    if args.port == 0:
        import socket
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind((args.host, 0))
            actual_port = s.getsockname()[1]
    else:
        actual_port = args.port

    # Output the port information for the extension to read
    print(f"CONAN_SERVER_PORT:{actual_port}", flush=True)
    print(
        f"Starting Conan API server on {args.host}:{actual_port}", flush=True)

    uvicorn.run(app, host=args.host, port=actual_port, log_level="warning")
