#!/usr/bin/env python3
"""
FastAPI server for Conan VS Code extension.
This server provides REST API endpoints for Conan operations.
"""

import os
import sys
import argparse
from typing import List, Optional
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
    from conan.api.model import ListPattern, RecipeReference, PkgReference
    from conan.internal.loader import load_python_file
    from conan.internal.graph.profile_node_definer import initialize_conanfile_profile
    from conan.internal.graph.graph import CONTEXT_BUILD
    from conan.internal.graph.graph import BINARY_BUILD, BINARY_CACHE, BINARY_DOWNLOAD, BINARY_INVALID
    from conan.internal.graph.graph import RECIPE_DOWNLOADED, RECIPE_INCACHE, RECIPE_UPDATED
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

# Pydantic models


class PackageAvailability(BaseModel):
    """Package availability information based on what Conan's analyze_binaries tells us."""

    # Simple derived flags for UI logic
    is_incompatible: bool = False  # True if package is incompatible with current profile

    # Local availability
    local_status: str = "none"
    remote_status: str = "none"


class ConanPackage(BaseModel):
    name: str
    version: str
    ref: str
    availability: PackageAvailability


class ConanProfile(BaseModel):
    name: str
    path: str


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
    build_profile: str
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


@app.get("/packages")
async def get_packages(workspace_path: str, host_profile: str, build_profile: str, remote: Optional[str] = None) -> List[ConanPackage]:
    """
    Get packages from conanfile in current workspace.

    Args:
        workspace_path: Path to the workspace containing conanfile (required)
        host_profile: Host profile name (required)
        build_profile: Build profile name (required) 
        remote: Specific remote to check. If None, checks all configured remotes (optional)

    Returns:
        List of packages with their availability status across local cache and remote(s)
    """
    if not os.path.exists(workspace_path):
        raise HTTPException(
            status_code=400, detail="Workspace path does not exist")
    conanfile_txt = os.path.join(workspace_path, "conanfile.txt")
    conanfile_py = os.path.join(workspace_path, "conanfile.py")

    packages = []

    try:
        if os.path.exists(conanfile_txt):
            packages = await parse_conanfile_txt(conanfile_txt, host_profile, build_profile, remote)
        elif os.path.exists(conanfile_py):
            packages = await parse_conanfile_py(conanfile_py, host_profile, build_profile, remote)
        else:
            raise HTTPException(
                status_code=404, detail="No conanfile found in workspace")
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error parsing conanfile: {str(e)}")

    return packages


async def parse_conanfile_txt(file_path: str, host_profile: str, build_profile: str, remote_name: Optional[str] = None) -> List[ConanPackage]:
    """Parse conanfile.txt and extract packages with optional remote filtering."""
    packages = []

    with open(file_path, 'r') as f:
        content = f.read()

    lines = content.split('\n')
    in_requires = False

    for line in lines:
        line = line.strip()
        if line == '[requires]':
            in_requires = True
            continue
        if line.startswith('[') and line != '[requires]':
            in_requires = False
            continue
        if in_requires and line and not line.startswith('#'):
            try:
                parts = line.split('/')
                if len(parts) >= 2:
                    name = parts[0]
                    version = parts[1]

                    # Get comprehensive package availability
                    availability = await check_package_availability(line, host_profile, build_profile, remote_name)

                    packages.append(ConanPackage(
                        name=name,
                        version=version,
                        ref=line,
                        availability=availability
                    ))
            except:
                continue

    return packages


async def parse_conanfile_py(file_path: str, host_profile: str, build_profile: str, remote_name: Optional[str] = None) -> List[ConanPackage]:
    """Parse conanfile.py and extract packages with optional remote filtering."""
    packages = []

    try:
        # Load the Python module
        module, _ = load_python_file(file_path)

        # Find the ConanFile class defined in the module
        conanfile_class = None
        for attr in dir(module):
            obj = getattr(module, attr)
            if isinstance(obj, type) and issubclass(obj, module.ConanFile) and obj.__name__ != "ConanFile":
                conanfile_class = obj
                break

        if conanfile_class:
            # Instantiate the conanfile
            conanfile = conanfile_class()

            # Load the specified profiles
            profile_host = conan_api.profiles.get_profile(
                [host_profile], {}, {}, {}, None)
            profile_build = conan_api.profiles.get_profile(
                [build_profile], {}, {}, {}, None)

            # Initialize the conanfile with profile (this is crucial for dynamic requirements)
            initialize_conanfile_profile(conanfile, profile_build=profile_build,
                                         profile_host=profile_host, base_context=CONTEXT_BUILD, is_build_require=False)

            # Call requirements() method to populate dynamic requirements
            if hasattr(conanfile, 'requirements'):
                conanfile.requirements()

            # Now process the populated requires
            if hasattr(conanfile, 'requires'):
                for r in conanfile.requires.values():
                    try:
                        req_str = str(r.ref)
                        parts = req_str.split('/')
                        if len(parts) >= 2:
                            name = parts[0]
                            version = parts[1]

                            # Get comprehensive package availability
                            availability = await check_package_availability(req_str, host_profile, build_profile, remote_name)

                            packages.append(ConanPackage(
                                name=name,
                                version=version,
                                ref=req_str,
                                availability=availability
                            ))
                    except Exception as e:
                        print(f"Error processing requirement {r}: {e}")
                        continue
    except Exception as e:
        print(f"Error parsing conanfile.py: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error parsing conanfile.py: {str(e)}")

    return packages


@app.get("/profiles")
async def get_profiles() -> List[ConanProfile]:
    """Get available Conan profiles."""
    if not conan_api:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:
        # Use Conan API to list profiles
        profiles_path = conan_api.config.home() + "/profiles"
        profiles = []

        if os.path.exists(profiles_path):
            for filename in os.listdir(profiles_path):
                if filename not in ['.', '..'] and not filename.startswith('.'):
                    profile_path = os.path.join(profiles_path, filename)
                    if os.path.isfile(profile_path):
                        profiles.append(ConanProfile(
                            name=filename, path=profile_path))

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
async def install_packages(workspace_path: str, request: InstallRequest):
    """Install packages from conanfile."""
    if not os.path.exists(workspace_path):
        raise HTTPException(
            status_code=400, detail="Workspace path does not exist")

    if not conan_api:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:
        conanfile_path = os.path.join(workspace_path, "conanfile.txt")
        if not os.path.exists(conanfile_path):
            conanfile_path = os.path.join(workspace_path, "conanfile.py")
            if not os.path.exists(conanfile_path):
                raise HTTPException(
                    status_code=404, detail="No conanfile found in workspace")

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
        # Use Conan API to create profile with auto-detection
        profile = conan_api.profiles.get_profile(
            [])  # Start with empty profile

        if request.detect:
            # Auto-detect settings for the profile
            from conan.internal.api.detect import detect_api
            detected_settings = detect_api(conan_api)
            profile.settings.update(detected_settings)

        # Save the profile
        profiles_path = conan_api.config.home() + "/profiles"
        os.makedirs(profiles_path, exist_ok=True)
        profile_file_path = os.path.join(profiles_path, request.name)

        # Write profile to file
        with open(profile_file_path, 'w') as f:
            f.write(str(profile))

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
async def upload_missing_packages(workspace_path: str, request: UploadRequest):
    """Upload missing packages to remote (synchronous)."""
    if not os.path.exists(workspace_path):
        raise HTTPException(
            status_code=400, detail="Workspace path does not exist")

    if not conan_api:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:
        # Execute upload synchronously
        result = await upload_packages_task(workspace_path, request)
        return {"message": "Package upload completed", "status": "completed", "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


async def upload_packages_task(workspace_path: str, request: UploadRequest):
    """Background task to upload packages."""
    try:
        conanfile_path = os.path.join(workspace_path, "conanfile.py")

        if not os.path.exists(conanfile_path):
            raise Exception("No conanfile.py found, cannot upload packages")

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


async def check_package_availability(package_ref: str, host_profile: str, build_profile: str, remote_name: Optional[str] = None) -> PackageAvailability:
    """
    Check package availability using Conan's graph analysis.
    Returns what Conan actually tells us through analyze_binaries.
    """
    try:
        if not conan_api:
            return PackageAvailability(
                recipe_status="error",
                binary_status="error"
            )

        # Get profiles
        profile_host = conan_api.profiles.get_profile(
            [host_profile], {}, {}, {}, None)
        profile_build = conan_api.profiles.get_profile(
            [build_profile], {}, {}, {}, None)

        # Set up remotes to check
        remotes = []
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

        # Create a dependency graph for this specific package requirement
        deps_graph = conan_api.graph.load_graph_requires(
            requires=[package_ref],
            tool_requires=None,
            profile_host=profile_host,
            profile_build=profile_build,
            lockfile=None,
            remotes=remotes,
            update=None  # Don't update, only check what's available
        )

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

        # Find the target package node in the graph
        target_node = None
        for node in deps_graph.nodes:
            # Match package name
            if node.ref and str(node.ref).startswith(package_ref.split('/')[0]):
                target_node = node
                break

        if not target_node:
            return PackageAvailability()

        # Extract what Conan tells us
        recipe_status = str(
            target_node.recipe) if target_node.recipe else "unknown"
        binary_status = str(
            target_node.binary) if target_node.binary else "unknown"

        # Determine simple flags for UI
        local_recipe_available = recipe_status == RECIPE_INCACHE
        local_binary_available = binary_status == BINARY_CACHE

        local_status = "none"
        if local_recipe_available:
            local_status = "recipe"
            if local_binary_available:
                local_status = "recipe+binary"

        is_incompatible = binary_status == BINARY_INVALID

        # Enhanced remote checking: if package is in local cache, also check remote availability
        remote_recipe_available = False
        remote_binary_available = False

        remote_status = 'none'

        if target_node.ref and target_node.package_id:
            try:
                # Check each configured remote
                for remote in remotes:
                    # Check if package exists for this recipe reference
                    try:
                        recipe_ref: RecipeReference = RecipeReference(
                            target_node.ref.name,
                            target_node.ref.version,
                            target_node.ref.user,
                            target_node.ref.channel
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
                            target_node.ref, target_node.package_id)
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
                    f"Error checking remote availability for {target_node.ref}: {e}")

        return PackageAvailability(
            is_incompatible=is_incompatible,
            local_status=local_status,
            remote_status=remote_status
        )

    except Exception as e:
        return PackageAvailability(
            recipe_status=f"error: {str(e)}",
            binary_status="error"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Conan VS Code Extension API Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8000,
                        help="Port to bind to")

    args = parser.parse_args()

    print(f"Starting Conan API server on {args.host}:{args.port}")

    uvicorn.run(app, host=args.host, port=args.port)
