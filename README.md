# Conan Package Manager

A comprehensive Visual Studio Code extension for managing Conan C++ packages, profiles, and remotes.

## 🚀 Features

### 🏗️ Activity Bar Integration
- **Conan Explorer**: Dedicated activity bar panel with three main sections:
  - **Packages**: View packages defined in your conanfile.txt or conanfile.py
  - **Profiles**: List and manage Conan profiles (host and build profiles)
  - **Remotes**: Configure and view Conan remotes

### 📦 Advanced Package Management
- **Install Packages**: One-click installation from conanfile.txt or conanfile.py
- **Upload Missing Packages**: Upload packages that are missing from remotes using Conan Python API
- **Upload Local Packages**: Upload individual packages to selected remotes
- **Auto-detection**: Automatically detects conanfile.txt and conanfile.py in your workspace
- **Build Support**: Installs packages with `--build=missing` flag for missing binaries
- **Visual Binary Status**: Different icons show package availability:
  - 📦 `$(archive)` - Binaries available on remotes
  - 📄 `$(file-code)` - Recipe only, needs building
  - � `$(error)` - Incompatible package
  - �📦 `$(package)` - Status unknown (fallback)

### 🔧 Advanced Server Integration
- **Built-in Server**: Integrated server for enhanced package operations
- **Real-time Status**: Server status monitoring with visual indicators
- **Background Operations**: Upload packages in the background with progress tracking

### 👤 Profile Management
- **Host & Build Profiles**: Support for both host and build profile management
- **Create Profiles**: Easy profile creation with auto-detection
- **View Profiles**: List all available Conan profiles via API or CLI
- **Profile Selection**: Quick profile switching via status bar
- **Refresh**: Update profile list on demand

### 🌐 Remote Management
- **Add Remotes**: Configure new Conan remotes with name and URL
- **List Remotes**: View all configured remotes with their URLs via API or CLI
- **Remote Selection**: Quick remote switching via status bar
- **Default Remotes**: Support for conancenter and custom remotes

### ⚡ Enhanced UI
- **Tree Views**: Hierarchical display of packages, profiles, and remotes in the activity bar
- **Terminal Integration**: Execute Conan commands in integrated terminal
- **Icons**: Beautiful icons for different item types and statuses
- **Server Status**: Visual indicators for API server status
- **Profile Status Bar**: Shows active host and build profiles in the status bar
- **Remote Status Bar**: Shows active Conan remote in the status bar

## 📋 Requirements

- **VS Code**: Version 1.101.0 or higher
- **Python Extension (ms-python.python)**: Required for server functionality
- **Conan**: Must be installed and available in your system PATH

## 🛠️ Installation

1. Install the extension from the VS Code marketplace
2. Ensure Python extension (ms-python.python) is installed
3. Ensure Conan is installed on your system
4. Open a workspace containing `conanfile.txt` or `conanfile.py`

## 🎯 Usage

### Quick Start
1. Open a workspace with a conanfile.txt or conanfile.py
2. Click the Conan icon in the activity bar
3. **Start the server** for enhanced functionality (optional)
4. Use the tree views to explore packages, profiles, and remotes
5. Upload missing packages to your private remotes

### Available Commands
- `Conan: Install Packages` - Install packages from conanfile
- `Conan: Create Profile` - Create a new Conan profile
- `Conan: Add Remote` - Add a new Conan remote
- `Conan: Upload Missing Packages` - Upload packages missing from remotes
- `Conan: Start Server` - Start the integrated server
- `Conan: Stop Server` - Stop the integrated server
- `Conan: Select Active Host Profile` - Choose active host profile from status bar
- `Conan: Select Active Build Profile` - Choose active build profile from status bar
- `Conan: Select Active Remote` - Choose active remote from status bar

### Advanced Features
The built-in server provides enhanced functionality:
- **Package Upload**: Upload missing packages to remotes
- **Background Processing**: Long-running operations don't block the UI
- **Status Monitoring**: Real-time feedback on operations
- **Binary Status Detection**: Automatic binary availability checking

### Upload Missing Packages Workflow
1. **Start the server** for enhanced functionality
2. Use `Conan: Upload Missing Packages` command
3. **Select target remote** from configured remotes
4. The extension analyzes your conanfile and uploads missing dependencies
5. **Monitor progress** through status updates

⚠️ **Important**: Start the server for enhanced functionality:
- Use the welcome notification when the extension activates
- Command: `Conan: Start Server`
- Command Palette: `Ctrl+Shift+P` → "Conan: Start Server"

### Profile Management with Status Bar
The extension provides convenient status bar items for profile management:

1. **View Active Profiles**: Look for `$(person) host-profile` and `$(tools) build-profile` in the bottom status bar
2. **Switch Profiles**: Click the status bar items to open quick pick menus
3. **Profile Persistence**: Selected profiles are saved per workspace
4. **Server Required**: Enhanced functionality requires the server to be running
5. **Auto-Detection**: New profiles are automatically detected and available for selection
6. **Command Integration**: The active profiles are used for `conan install` and other operations

**Keyboard Shortcuts**: 
- Use `Ctrl+Shift+P` → `Conan: Select Active Host Profile` to change host profiles
- Use `Ctrl+Shift+P` → `Conan: Select Active Build Profile` to change build profiles

### Remote Management with Status Bar
The extension provides a convenient status bar item showing the currently active Conan remote:

1. **View Active Remote**: Look for `$(globe) remote-name` in the bottom status bar
2. **Switch Remotes**: Click the status bar item to open a quick pick menu
3. **Remote Persistence**: Selected remote is saved per workspace
4. **All Remotes Option**: Select "all" to check packages across all configured remotes
5. **Binary Status Updates**: Package icons update based on the selected remote's binary availability

**Keyboard Shortcut**: Use `Ctrl+Shift+P` → `Conan: Select Active Remote` to change remotes

### Package Binary Status Indicators
The extension shows visual indicators for package binary availability:

| Icon | Status | Description |
|------|--------|-------------|
| 📦 `$(archive)` | **Binaries Available** | Package binaries are available on configured remotes |
| 📄 `$(file-code)` | **Recipe Only** | Only recipe is available, binaries need to be built locally |
| � `$(error)` | **Incompatible** | Package is incompatible with current configuration |
| �📦 `$(package)` | **Unknown** | Binary status could not be determined (CLI fallback mode) |

**Note**: Binary status checking requires the server to be running for accurate results. In CLI fallback mode, status detection is limited. Binary availability is checked against the currently selected remote, providing more precise information for download and upload operations.

The extension expects these files in your workspace:
- `conanfile.txt` or `conanfile.py` - Your Conan dependencies


## 🔧 Configuration

### Extension Settings
The extension provides workspace-specific configuration options:

- `conan.activeHostProfile` - Active Conan host profile for package operations
- `conan.activeBuildProfile` - Active Conan build profile for package operations
- `conan.activeRemote` - Active Conan remote for package operations (default: "all")

## 📖 Example Usage

### Example conanfile.txt
```ini
[requires]
zlib/1.2.11
openssl/1.1.1l
boost/1.82.0

[generators]
CMakeDeps
CMakeToolchain

[options]
boost:shared=True
openssl:shared=True
```

### Example conanfile.py
```python
from conan import ConanFile
from conan.tools.cmake import CMakeDeps, CMakeToolchain

class ExampleConan(ConanFile):
    requires = [
        "zlib/1.2.11",
        "openssl/1.1.1l",
        "boost/1.82.0"
    ]
    
    def generate(self):
        deps = CMakeDeps(self)
        deps.generate()
        tc = CMakeToolchain(self)
        tc.generate()
```

## 🔄 Extension Activation

The extension automatically activates when:
- A workspace contains `conanfile.txt`
- A workspace contains `conanfile.py`

## 🐛 Troubleshooting

### Server issues
- Ensure Python extension (ms-python.python) is installed and active
- Restart VS Code if the server fails to start
- Ensure port 8000 is not in use by another application

### Extension not activating
- Ensure your workspace contains conanfile.txt or conanfile.py
- Check the file is in the workspace root
- Reload the window: `Ctrl+Shift+P` → "Developer: Reload Window"

## 🤝 Contributing

We welcome contributions! 

- 📖 [Development Guide](CONTRIBUTING.md) - Setup instructions and development workflow
- 🐛 [Report Issues](https://github.com/roknus/conan-vscode/issues) - Bug reports and feature requests
- 💬 [Discussions](https://github.com/roknus/conan-vscode/discussions) - Community Q&A
- 📚 [Repository](https://github.com/roknus/conan-vscode) - Source code and documentation

## 📄 License

This extension is provided under the MIT License.

---

**Manage your Conan packages like a pro! 🎉**
