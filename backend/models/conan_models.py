from typing import List, Optional, Dict
from pydantic import BaseModel



class ConanSettings(BaseModel):
    """Conan settings structure."""
    path: str                           # Path to settings file in home folder

    os: Dict[str, dict] = {}            # e.g., {"Windows": {}, "Linux": {}}
    arch: List[str] = []                # e.g., ["x86_64", "armv8"]

    # e.g., {"gcc": {"version": ["9", "10"], "libcxx": ["libstdc++11"]}, "clang": {...}}
    compiler: Dict[str, dict] = {}
    build_type: List[str | None] = []   # e.g., ["Debug", "Release"]

class PackageLocalStatus(BaseModel):
    """Package availability status in the cache."""

    recipe_status: str
    binary_status: str

class PackageRemoteStatus(BaseModel):
    """Package availability status on a specific remote."""

    remote_name: str
    recipe_status: str
    binary_status: str

class PackageAvailability(BaseModel):
    """Package availability information based on what Conan's analyze_binaries tells us."""

    is_incompatible: bool = False
    incompatible_reason: Optional[str] = None

    # Local availability
    local_status: PackageLocalStatus = None

    # Remote availability
    remotes_status: List[PackageRemoteStatus] = []


class ConanPackage(BaseModel):
    name: str
    version: str
    ref: str
    id: str
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
    requires_auth: bool = False


class UploadRequest(BaseModel):
    workspace_path: str
    remote_name: str
    packages: List[str]
    host_profile: str
    build_profile: str
    force: bool = False


class UploadLocalRequest(BaseModel):
    workspace_path: str
    remote_name: str
    package_ref: str
    package_id: str
    host_profile: str
    force: bool = False


class InstallRequest(BaseModel):
    workspace_path: str
    build_missing: bool = True
    host_profile: str
    build_profile: str


class InstallPackageRequest(BaseModel):
    workspace_path: str
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

class RemoteLoginRequest(BaseModel):
    name: str
    user: str
    password: str

class RemoveRemoteRequest(BaseModel):
    name: str