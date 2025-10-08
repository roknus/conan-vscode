from typing import List
from fastapi import APIRouter, HTTPException

from models.conan_models import ConanRemote, RemoteAddRequest, RemoteLoginRequest, RemoveRemoteRequest
from dependencies.conan_deps import get_conan_api
from conan_utils import is_authenticated

try:
    from conan.api.model import Remote
except ImportError:
    print("ERROR: Conan Python API not found. Make sure Conan 2.x is installed.")

router = APIRouter(prefix="/remotes", tags=["remotes"])


@router.get("", response_model=List[ConanRemote])
async def get_remotes() -> List[ConanRemote]:
    """Get configured Conan remotes."""
    conan_api = get_conan_api()
    if conan_api is None:
        raise HTTPException(status_code=500, detail="Conan API not initialized")

    try:
        remotes_list = conan_api.remotes.list()
        remotes = []

        for remote in remotes_list:
            # Check if authentication is required for this remote
            requires_auth = not is_authenticated(conan_api, remote)

            remotes.append(ConanRemote(
                name=remote.name,
                url=remote.url,
                verify_ssl=remote.verify_ssl,
                requires_auth=requires_auth
            ))

        return remotes
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error getting remotes: {str(e)}")


@router.post("/add")
async def add_remote(request: RemoteAddRequest):
    """Add a new Conan remote."""
    conan_api = get_conan_api()
    if conan_api is None:
        raise HTTPException(status_code=500, detail="Conan API not initialized")

    try:
        # Create a new remote object
        new_remote = Remote(request.name, request.url, request.verify_ssl)

        # Add the remote using the API
        conan_api.remotes.add(new_remote)

        # Check if authentication is required for this remote
        requires_auth = not is_authenticated(conan_api, new_remote)

        return {"success": True, "requires_auth": requires_auth}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error adding remote: {str(e)}")


@router.post("/login")
async def login_remote(request: RemoteLoginRequest):
    """Login to a Conan remote."""
    conan_api = get_conan_api()
    if conan_api is None:
        raise HTTPException(status_code=500, detail="Conan API not initialized")

    try:
        # Get the remote
        remote = conan_api.remotes.get(request.name)
        if not remote:
            raise HTTPException(
                status_code=404, detail=f"Remote '{request.name}' not found")

        # Perform login
        conan_api.remotes.user_login(remote, request.user, request.password)

        return {"success": True, "message": f"Logged in to remote '{request.name}' successfully"}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error logging in to remote: {str(e)}")


@router.post("/remove")
async def remove_remote(request: RemoveRemoteRequest):
    """Remove a Conan remote."""
    conan_api = get_conan_api()
    if conan_api is None:
        raise HTTPException(status_code=500, detail="Conan API not initialized")

    try:
        # Remove the remote using the API
        conan_api.remotes.remove(request.name)

        return {"success": True}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error removing remote: {str(e)}")