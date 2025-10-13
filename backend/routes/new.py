from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from dependencies.conan_deps import get_conan_api

router = APIRouter(prefix="/new", tags=["new"])

class CreateProjectRequest(BaseModel):
    workspace_path: str
    template: str
    name: Optional[str] = None

@router.post('')
def create_new_project(request: CreateProjectRequest):
    """Create a new Conan project with specified template"""
    try:
        conan_api = get_conan_api()
        if conan_api is None:
            raise HTTPException(
                status_code=500, detail="Conan API not initialized")

        conan_api.new.save_template(request.template, [f"name={request.name}"], request.workspace_path)
        
        return {
            "message": f"Project {request.name} created at {request.workspace_path} using template {request.template}",
            "status": "completed"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
