import os
import sys
from typing import Optional
from fastapi import HTTPException

try:
    from conan.api.conan_api import ConanAPI
except ImportError:
    print("ERROR: Conan Python API not found. Make sure Conan 2.x is installed.")
    sys.exit(1)

# Global variable for ConanAPI instance
conan_api: Optional[ConanAPI] = None


def get_conan_api() -> ConanAPI:
    """Get the global ConanAPI instance."""
    global conan_api
    if not conan_api:
        raise HTTPException(
            status_code=500, detail="Conan API not initialized")
    return conan_api


def set_conan_api(api: ConanAPI):
    """Set the global ConanAPI instance."""
    global conan_api
    conan_api = api


def find_conanfile(workspace_path: str) -> str:
    """
    Find conanfile in the specified workspace directory.

    Args:
        workspace_path: Path to the workspace directory.

    Returns:
        Path to the found conanfile (conanfile.txt or conanfile.py)

    Raises:
        HTTPException: If no conanfile is found
    """
    conanfile_txt = os.path.join(workspace_path, "conanfile.txt")
    conanfile_py = os.path.join(workspace_path, "conanfile.py")

    if os.path.exists(conanfile_txt):
        return os.path.abspath(conanfile_txt)
    elif os.path.exists(conanfile_py):
        return os.path.abspath(conanfile_py)
    else:
        raise HTTPException(
            status_code=404, detail=f"No conanfile found in workspace directory: {workspace_path}")
