from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from dependencies.conan_deps import find_conanfile, get_conan_api
import os
import subprocess
import sys

router = APIRouter(prefix="/project", tags=["project"])


class ProjectOperationRequest(BaseModel):
    workspace_path: str
    host_profile: str
    build_profile: str
    options: dict = {}


@router.post("/create")
async def create_package(request: ProjectOperationRequest):
    """Create the package in the workspace."""
    conan_api = get_conan_api()
    if conan_api is None:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:

        conanfile_path = find_conanfile(request.workspace_path)

        # Get profiles
        profile_host = conan_api.profiles.get_profile(
            [request.host_profile], {}, {}, {}, None)
        profile_build = conan_api.profiles.get_profile(
            [request.build_profile], {}, {}, {}, None)

        # Get remotes
        remotes = conan_api.remotes.list()

        ref, conanfile = conan_api.export.export(path=conanfile_path,
                                                 name=None, version=None, user=None, channel=None,
                                                 lockfile=None,
                                                 remotes=remotes)

        # Create dependency graph
        deps_graph = conan_api.graph.load_graph_requires(
            requires=[ref],
            tool_requires=None,
            profile_host=profile_host,
            profile_build=profile_build,
            lockfile=None,
            remotes=remotes,
            update=None
        )

        # Analyze binaries and determine what to build
        conan_api.graph.analyze_binaries(
            deps_graph,
            build_mode=[f'missing:{str(ref)}'],
            remotes=remotes,
            update=None,
            lockfile=None,
            build_modes_test=None,
            tested_graph=None
        )

        # Install binaries
        conan_api.install.install_binaries(
            deps_graph=deps_graph, remotes=remotes)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Create operation failed: {str(e)}"
        )


@router.post("/test")
async def test_package(request: ProjectOperationRequest):
    """Test the package in the workspace."""
    conan_api = get_conan_api()
    if conan_api is None:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")

    try:
        # Change to workspace directory
        original_dir = os.getcwd()
        os.chdir(request.workspace_path)

        # Test command args
        cmd = [
            sys.executable, "-c", "from conan.api.conan_api import ConanAPI; "
            f"ConanAPI().test.test_package(['.'], host_profile='{request.host_profile}', "
            f"build_profile='{request.build_profile}')"
        ]

        # Run the test command
        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            raise HTTPException(
                status_code=400,
                detail=f"Test failed: {result.stderr}"
            )

        return {
            "success": True,
            "message": "Package tested successfully",
            "output": result.stdout
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Test operation failed: {str(e)}"
        )
    finally:
        os.chdir(original_dir)
