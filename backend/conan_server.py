#!/usr/bin/env python3
"""
FastAPI server for Conan VS Code extension.
This server provides REST API endpoints for Conan operations.
"""

import sys
import argparse
from contextlib import asynccontextmanager

from fastapi import HTTPException

try:
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
except ImportError:
    print("ERROR: FastAPI dependencies not found. Install with: pip install fastapi uvicorn")
    sys.exit(1)

# Import Conan Python API
try:
    from conan.api.conan_api import ConanAPI
    from conan.internal.model.settings import load_settings_yml
except ImportError:
    print("ERROR: Conan Python API not found. Make sure Conan 2.x is installed.")
    sys.exit(1)

# Import route modules
from routes.packages import router as packages_router
from routes.profiles import router as profiles_router
from routes.remotes import router as remotes_router
from routes.project import router as project_router
from routes.new import router as new_router
from dependencies.conan_deps import get_conan_api, set_conan_api
from models.conan_models import ConanSettings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler for FastAPI application."""
    # Startup
    try:
        conan_api = ConanAPI()
        conan_api._api_helpers.set_core_confs(["core:non_interactive=True"])
        set_conan_api(conan_api)
        print("Conan API initialized successfully")
    except Exception as e:
        print(f"Failed to initialize Conan API: {e}")
        set_conan_api(None)

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

# Include routers
app.include_router(packages_router)
app.include_router(profiles_router)
app.include_router(remotes_router)
app.include_router(project_router)
app.include_router(new_router)


@app.get("/")
async def root():
    """Root endpoint to check if server is running."""
    return {"message": "Conan VS Code Extension API Server", "status": "running"}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


# Legacy endpoints for backward compatibility
@app.get("/settings")
async def get_settings_legacy():
    """Get available Conan settings from settings.yml."""
    conan_api = get_conan_api()
    if conan_api is None:
        raise HTTPException(status_code=500, detail="Conan API not initialized")

    try:
        # Get Conan home folder
        home_folder = conan_api.config.home()

        # Load settings using load_settings_yml
        settings_obj = load_settings_yml(home_folder)

        # Get the settings path for the response
        from conan.internal.cache.home_paths import HomePaths
        home_paths = HomePaths(home_folder)
        settings_path = home_paths.settings_path

        # Extract settings structure from the loaded Settings object
        possible_values = settings_obj.possible_values()

        # Convert to ConanSettings format
        conan_settings = ConanSettings(
            path=settings_path,
            os=possible_values.get("os", {}),
            arch=list(possible_values.get("arch", [])),
            compiler=possible_values.get("compiler", {}),
            build_type=list(possible_values.get("build_type", []))
        )

        return conan_settings

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error loading settings: {str(e)}")


@app.get("/config/home")
async def get_conan_home_legacy():
    """Get Conan home directory path."""
    conan_api = get_conan_api()
    if conan_api is None:
        raise HTTPException(status_code=500, detail="Conan API not initialized")

    try:
        home_folder = conan_api.config.home()
        return home_folder
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error getting Conan home: {str(e)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Conan VS Code Extension API Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=0,
                        help="Port to bind to (0 for any available port)")

    args = parser.parse_args()

    # If port is 0, let uvicorn choose an available port
    if args.port == 0:
        import socket
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind((args.host, 0))
            actual_port = s.getsockname()[1]
    else:
        actual_port = args.port

    # Output the port information for the extension to read
    print(f"CONAN_SERVER_PORT:{actual_port}", flush=True)
    print(
        f"Starting Conan API server on {args.host}:{actual_port}", flush=True)

    uvicorn.run(app, host=args.host, port=actual_port, log_level="warning")
