"""
Conan utility classes for VS Code extension.
This module contains utility classes for Conan authentication and API management.
"""

try:
    from conan.api.conan_api import ConanAPI
    from conan.internal.conan_app import ConanBasicApp
    from conan.api.model import Remote
    from conan.internal.errors import NotFoundException, ConanException
except ImportError:
    print("ERROR: Conan Python API not found. Make sure Conan 2.x is installed.")
    raise


def is_authenticated(conan_api: ConanAPI, remote: Remote) -> bool:
    """
    Convenience function to check if user is authenticated to a remote.

    Args:
        conan_api: The ConanAPI instance
        remote: The remote to check (can be remote object or string name)

    Returns:
        bool: True if authenticated, False otherwise
    """

    try:
        app = ConanBasicApp(conan_api)
        app.remote_manager.check_credentials(remote, False)
        return True
    except NotFoundException:
        # 404 Looks like 404 means no authentication required (conancenter)
        return True
    except ConanException as e:
        # If exception occurs, assume not authenticated
        print(f"Error checking credentials: {e}")
        return False
