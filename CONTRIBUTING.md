# Contributing to Conan Package Manager Extension

Thank you for your interest in contributing to the Conan Package Manager VS Code extension! This guide will help you set up your development environment and understand the project structure.

## 🔧 Building the Extension

### Prerequisites
- **Node.js**: Version 20.x or higher
- **npm**: Latest version
- **Python**: Version 3.8 or higher (required for the backend server)
- **VS Code**: Version 1.101.0 or higher

### Development Setup
1. **Clone the repository**:
   ```bash
   git clone https://github.com/roknus/conan-vscode.git
   cd conan-vscode
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the extension**:
   ```bash
   npm run compile
   ```

### Available Build Scripts
- `npm run compile` - Compile the extension for debugging
- `npm run package` - Build production-ready package
- `npm run watch` - Watch mode for development (runs TypeScript and esbuild watchers)
- `npm run watch:esbuild` - Watch mode for esbuild only
- `npm run watch:tsc` - Watch mode for TypeScript checking only
- `npm run lint` - Run ESLint on source files
- `npm run check-types` - Type check without emitting files
- `npm run test` - Run extension tests

### Development Workflow
1. **Start development mode**:
   ```bash
   npm run watch
   ```
   This runs both TypeScript type checking and esbuild compilation in watch mode.

2. **Open in VS Code**: Press `F5` to launch a new Extension Development Host window for testing.

3. **Package for distribution**:
   ```bash
   npm run package
   ```
   This creates the production build in the `dist/` directory.

### Creating VSIX Package
To create a `.vsix` file for distribution:
```bash
npx @vscode/vsce package
```

This will generate a `conan-package-manager-0.0.1.vsix` file that can be installed in VS Code.

## 🏗️ Project Architecture

### Extension Structure
- **TypeScript Extension**: Main extension code in `src/`
- **Python Backend**: FastAPI server (`conan_server.py`) for Conan operations
- **Build System**: esbuild for bundling, TypeScript for type checking

### Key Components
- **ConanServerManager**: Manages the Python FastAPI server lifecycle
- **Tree Data Providers**: Handle the activity bar views (packages, profiles, remotes)
- **Commands**: VS Code command implementations
- **Python Integration**: Uses ms-python extension for Python environment management

### Python Backend Details
The extension includes a FastAPI server (`conan_server.py`) that:
- Handles all Conan CLI operations
- Provides REST API endpoints for package, profile, and remote management
- Runs in a virtual environment managed by the extension
- Uses the Conan Python API for advanced operations

### Virtual Environment Management
The extension automatically:
1. Creates a Python virtual environment in `.venv/`
2. Installs required Python dependencies from `requirements.txt`
3. Uses the virtual environment's Python executable to run the server
4. Manages the lifecycle of the virtual environment

### Build System
- **esbuild**: Bundles the extension for production
- **TypeScript**: Provides type checking and compilation
- **ESLint**: Code linting and style enforcement
- **Copy Files Plugin**: Ensures Python files are included in the distribution

## 🧪 Testing

Run the test suite:
```bash
npm test
```

For development testing:
1. Press `F5` to launch Extension Development Host
2. Open a workspace with `conanfile.txt` or `conanfile.py`
3. Test extension functionality

## 📦 Packaging Requirements

⚠️ **CRITICAL**: When adding new Python files:
1. Create the Python file
2. **IMMEDIATELY** add it to the `copyFilesPlugin` in `esbuild.js`
3. Test the build with `npm run compile`
4. Verify the file appears in `dist/` directory

Example esbuild.js configuration:
```javascript
const copyFilesPlugin = {
  name: 'copy-files',
  setup(build) {
    build.onEnd(() => {
      // Copy Python files to dist
      fs.copyFileSync('conan_server.py', 'dist/conan_server.py');
      fs.copyFileSync('conan_utils.py', 'dist/conan_utils.py');
      // Add any new Python files here
    });
  }
};
```

## 🐛 Debugging

### Extension Debugging
1. Set breakpoints in TypeScript code
2. Press `F5` to start debugging
3. Use VS Code Developer Tools (`Help > Toggle Developer Tools`)

### Python Server Debugging
1. Check server logs in VS Code Output panel
2. Server runs on `http://127.0.0.1:8000`
3. API documentation available at `http://127.0.0.1:8000/docs`

### Common Issues
- **Virtual environment issues**: Check Python extension is installed
- **Build failures**: Ensure all Python files are in esbuild.js
- **Server not starting**: Verify Python dependencies and port availability

## 🤝 Contributing Guidelines

### Code Style
- Follow TypeScript best practices
- Use ESLint configuration provided
- Add type annotations where helpful
- Document complex functions

### Pull Request Process
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Ensure all tests pass
6. Update documentation as needed
7. Submit a pull request

### Commit Messages
Use conventional commit format:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `refactor:` for code refactoring
- `test:` for adding tests

## 📄 License

This project is licensed under the MIT License. See the LICENSE file for details.

## 🆘 Getting Help

- **Issues**: Report bugs and request features on [GitHub Issues](https://github.com/roknus/conan-vscode/issues)
- **Discussions**: Ask questions on [GitHub Discussions](https://github.com/roknus/conan-vscode/discussions)
- **Documentation**: Check the project [Wiki](https://github.com/roknus/conan-vscode/wiki) for additional documentation

---

Happy coding! 🚀