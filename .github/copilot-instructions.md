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
