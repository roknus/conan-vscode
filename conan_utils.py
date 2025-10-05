"""
Conan utility classes for VS Code extension.
This module contains utility classes for Conan authentication and API management.
"""

try:
    from conan.api.conan_api import ConanAPI
    from conan.internal.conan_app import ConanApp
    from conan.internal.rest.rest_client import RestApiClient
    from conan.internal.api.remotes.localdb import LocalDB
    from conan.internal.errors import AuthenticationException, NotFoundException, ForbiddenException
    from conan.api.model import Remote
    from conan.api.output import ConanOutput
except ImportError:
    print("ERROR: Conan Python API not found. Make sure Conan 2.x is installed.")
    raise


class VSCodeRemoteCreds:
    """Handles remote credentials for VS Code Conan integration."""
    
    def __init__(self, localdb):
        self._localdb = localdb

    def get(self, remote):
        """Get credentials for a remote, caching them on the remote object."""
        creds = getattr(remote, "_creds", None)
        if creds is None:
            user, token, _ = self._localdb.get_login(remote.url)
            creds = user, token
            usermsg = f"with user '{user}'" if user else "anonymously"
            ConanOutput().info(f"Connecting to remote '{remote.name}' {usermsg}")
            setattr(remote, "_creds", creds)
        return creds


class VSCodeConanApiAuthManager:
    """Authentication manager for Conan API operations in VS Code extension."""
    
    def __init__(self, requester, cache_folder, localdb, global_conf):
        self._requester = requester
        self._creds = VSCodeRemoteCreds(localdb)
        self._global_conf = global_conf
        self._cache_folder = cache_folder

    def is_authenticated(self, remote):
        """
        Check if user is authenticated to a remote.
        Handles AuthenticationException and returns boolean status.
        
        Args:
            remote: The remote to check authentication for
            
        Returns:
            bool: True if authenticated or remote works anonymously, False otherwise
        """
        user, token = self._creds.get(remote)
        rest_client = RestApiClient(remote, token, self._requester, self._global_conf)
        try:
            rest_client.check_credentials(False)
        except NotFoundException:
            return True  # Remote works anonymously
        except AuthenticationException:
            return False
        except ForbiddenException:
            return False
        except Exception as e:
            ConanOutput().error(f"Authentication failed for remote '{remote.name}': {e}")
            return False
        return True


def is_authenticated(conan_api: ConanAPI, remote: Remote) -> bool:
    """
    Convenience function to check if user is authenticated to a remote.
    
    Args:
        conan_api: The ConanAPI instance
        remote: The remote to check (can be remote object or string name)
        
    Returns:
        bool: True if authenticated, False otherwise
    """
    auth = VSCodeConanApiAuthManager(
        conan_api._api_helpers.requester, 
        conan_api.home_folder, 
        LocalDB(conan_api.home_folder), 
        conan_api._api_helpers.global_conf
    )
    return auth.is_authenticated(remote)