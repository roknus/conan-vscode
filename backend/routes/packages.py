from typing import List, Optional
from fastapi import APIRouter, HTTPException
import sys

from models.conan_models import (
    ConanPackage, PackageAvailability, PackageRemoteStatus,
    InstallRequest, InstallPackageRequest, UploadLocalRequest
)
from dependencies.conan_deps import get_conan_api, find_conanfile
from conan_utils import is_authenticated

try:
    from conan.api.model import ListPattern, RecipeReference, PkgReference, Remote
    from conan.api.conan_api import ConanAPI
    from conan.errors import ConanException
    from conan.internal.graph.graph import Node
    from conan.internal.graph.graph import BINARY_BUILD, BINARY_CACHE, BINARY_DOWNLOAD, BINARY_INVALID
    from conan.internal.graph.graph import RECIPE_DOWNLOADED, RECIPE_INCACHE, RECIPE_UPDATED
except ImportError:
    print("ERROR: Conan Python API not found. Make sure Conan 2.x is installed.")
    sys.exit(1)

router = APIRouter(prefix="/packages", tags=["packages"])


def create_package_from_node(conan_api: ConanAPI, node: Node, remotes: List[Remote]) -> ConanPackage:

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

    remotes_status: List[PackageRemoteStatus] = []

    try:
        # Check each configured remote
        for remote in remotes:

            # Enhanced remote checking: if package is in local cache, also check remote availability
            remote_recipe_available = False
            remote_binary_available = False
            remote_status = "none"

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

            remotes_status.append(PackageRemoteStatus(
                remote_name=remote.name,
                status=remote_status
            ))

    except Exception as e:
        print(
            f"Error checking remote availability for {node.ref}: {e}")

    dependencies: List[ConanPackage] = []
    for edge in node.edges:
        package = create_package_from_node(conan_api, edge.dst, remotes)
        dependencies.append(package)

    availability = PackageAvailability(
        is_incompatible=is_incompatible,
        incompatible_reason=incompatible_reason,
        local_status=local_status,
        remotes_status=remotes_status
    )

    package = ConanPackage(
        name=node.ref.name,
        version=str(node.ref.version),
        ref=str(node.ref),
        id=node.package_id,
        dependencies=dependencies,
        availability=availability
    )

    return package


async def parse_conanfile(conan_api: ConanAPI, file_path: str, host_profile: str, build_profile: str, remote_name: Optional[str] = None) -> List[ConanPackage]:
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
                    package = create_package_from_node(conan_api, edge.dst, remotes)
                    packages.append(package)

            except Exception as e:
                print(f"Error analyzing package {dep.ref}: {e}")

        return packages
    except Exception as e:
        print(f"Error parsing conanfile: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error parsing conanfile: {str(e)}")


@router.get("", response_model=List[ConanPackage])
async def get_packages(
        workspace_path: str,
        host_profile: str,
        build_profile: str,
        remote: Optional[str] = None) -> List[ConanPackage]:
    """
    Get packages from conanfile in current workspace.

    Args:
        host_profile: Host profile name (required)
        build_profile: Build profile name (required)
        remote: Specific remote to check. If None, checks all configured remotes (optional)

    Returns:
        List of packages with their availability status across local cache and remote(s)
    """
    conan_api = get_conan_api()
    if conan_api is None:
        raise HTTPException(status_code=500, detail="Conan API not initialized")
    
    try:
        conanfile_path = find_conanfile(workspace_path)

        packages = await parse_conanfile(conan_api, conanfile_path, host_profile, build_profile, remote)

        return packages
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error parsing conanfile: {str(e)}")


@router.post("/install")
async def install_packages(request: InstallRequest):
    """Install packages from conanfile."""
    conan_api = get_conan_api()
    if conan_api is None:
        raise HTTPException(status_code=500, detail="Conan API not initialized")

    try:
        conanfile_path = find_conanfile(request.workspace_path)

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


@router.post("/install/package")
async def install_package(request: InstallPackageRequest):
    """Install a specific package by reference."""
    conan_api = get_conan_api()
    if conan_api is None:
        raise HTTPException(status_code=500, detail="Conan API not initialized")

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


@router.post("/upload/local")
async def upload_local_package(request: UploadLocalRequest):
    """Upload a specific local package to remote (synchronous)."""
    conan_api = get_conan_api()
    if conan_api is None:
        raise HTTPException(status_code=500, detail="Conan API not initialized")

    try:
        # Get the remote
        remote = conan_api.remotes.get(request.remote_name)
        remotes = conan_api.remotes.list()

        # Check if package exists locally first
        try:
            from conan.api.model import ListPattern
            ref_pattern = ListPattern(request.package_ref, package_id=request.package_id)

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