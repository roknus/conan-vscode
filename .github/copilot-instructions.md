<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# Conan Package Manager VS Code Extension

This is a VS Code extension project for Conan C++ package manager. Please use the get_vscode_api with a query as input to fetch the latest VS Code API references.

## Project Structure
- Extension provides commands to install Conan packages
- UI panel to display and manage packages, profiles, and remotes
- Uses tree data providers for displaying hierarchical data
- Webview panels for enhanced UI interactions

## Conan Integration
- Commands should execute Conan CLI commands (conan install, conan profile list, etc.)
- Error handling for cases where Conan is not installed
- Support for conanfile.txt and conanfile.py detection
- Workspace-aware package management

## Packaging Requirements ⚠️ CRITICAL ⚠️
- **ALWAYS check esbuild.js when creating new Python files (*.py)**
- **ALL Python files required by the extension at runtime MUST be added to the copyFilesPlugin in esbuild.js**
- Python files need to be copied to the dist/ directory during build for the extension to work properly
- When creating any new .py file that will be imported or executed by the extension:
  1. Create the file
  2. **IMMEDIATELY** add it to the copyFilesPlugin in esbuild.js
  3. Test the build process with `npm run compile`
  4. Verify the file appears in the dist/ directory
- Examples of files that must be packaged: conan_server.py, conan_utils.py, any other Python dependencies
- **Failure to do this will cause runtime errors in the packaged extension**
