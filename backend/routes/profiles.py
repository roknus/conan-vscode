import os
from typing import List, Optional
from fastapi import APIRouter, HTTPException

from models.conan_models import ConanProfile, ProfileCreateRequest
from dependencies.conan_deps import get_conan_api

router = APIRouter(prefix="/profiles", tags=["profiles"])


@router.get("", response_model=List[ConanProfile])
async def get_profiles(local_profiles_path: Optional[str] = None) -> List[ConanProfile]:
    """Get available Conan profiles."""
    conan_api = get_conan_api()
    if conan_api is None:
        raise HTTPException(status_code=500, detail="Conan API not initialized")

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


@router.post("/create")
async def create_profile(request: ProfileCreateRequest):
    """Create a new Conan profile."""
    conan_api = get_conan_api()
    if conan_api is None:
        raise HTTPException(status_code=500, detail="Conan API not initialized")

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