import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { PythonExtension } from '@vscode/python-extension';

// Global logger instance
let logger: vscode.LogOutputChannel;

// Utility function for logging API operations
function logApiOperation(operation: string, details?: any) {
    if (details) {
        logger.debug(`API: ${operation}`, details);
    } else {
        logger.debug(`API: ${operation}`);
    }
}

type PackageStatus = 'none' | 'recipe' | 'recipe+binary'

// TypeScript interfaces for API responses
interface PackageAvailability {
    is_incompatible: boolean;
    local_status: PackageStatus;
    remote_status: PackageStatus;
}

interface PackageInfo {
    name: string;
    ref: string;
    availability: PackageAvailability;
}

interface Profile {
    name: string;
}

interface Remote {
    name: string;
    url: string;
}

// Valid item types for tree items
type ItemType =
    // Package types
    | 'package-available'
    | 'package-downloadable'
    | 'package-uploadable'
    | 'package-buildable'
    | 'package-incompatible'
    | 'package-unknown'
    | 'package' // generic package
    // Non-package types
    | 'profile'
    | 'remote'
    | 'info'
    | 'error'
    | 'warning';

// Server configuration
const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 8000;
const SERVER_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;

// Global state for active profiles
let activeHostProfile: string = 'default';
let activeBuildProfile: string = 'default';
let hostProfileStatusBarItem: vscode.StatusBarItem;
let buildProfileStatusBarItem: vscode.StatusBarItem;

// Global state for active remote
let activeRemote: string = 'all';
let remoteStatusBarItem: vscode.StatusBarItem;

// Server state management
class ConanServerManager {
    private serverProcess: cp.ChildProcess | null = null;
    private isServerRunning = false;
    private pythonApi: PythonExtension | null = null;
    private venvPath: string | null = null;

    private async setupVirtualEnvironment(extensionPath: string, basePythonPath: string): Promise<string | null> {
        try {
            // Create venv directory in extension path
            const venvDir = path.join(extensionPath, '.venv');
            this.venvPath = venvDir;

            // Check if venv already exists
            const venvPythonPath = process.platform === 'win32'
                ? path.join(venvDir, 'Scripts', 'python.exe')
                : path.join(venvDir, 'bin', 'python');

            if (fs.existsSync(venvPythonPath)) {
                console.log(`Using existing virtual environment: ${venvDir}`);

                // Verify the venv is working by checking Python version
                try {
                    const versionCheck = cp.spawnSync(venvPythonPath, ['--version'], { encoding: 'utf8' });
                    if (versionCheck.status === 0) {
                        console.log(`Virtual environment Python version: ${versionCheck.stdout.trim()}`);
                        return venvPythonPath;
                    } else {
                        console.warn('Existing virtual environment appears to be corrupted, recreating...');
                        // Remove the corrupted venv and recreate
                        fs.rmSync(venvDir, { recursive: true, force: true });
                    }
                } catch (error) {
                    console.warn('Failed to verify existing virtual environment, recreating...');
                    fs.rmSync(venvDir, { recursive: true, force: true });
                }
            }

            console.log(`Creating virtual environment at: ${venvDir}`);
            vscode.window.showInformationMessage('Creating Python virtual environment for Conan extension...');

            // Create virtual environment
            const createVenvProcess = cp.spawn(basePythonPath, ['-m', 'venv', venvDir], {
                stdio: 'pipe',
                env: { ...process.env }
            });

            let createVenvOutput = '';
            createVenvProcess.stdout?.on('data', (data) => {
                createVenvOutput += data.toString();
            });

            createVenvProcess.stderr?.on('data', (data) => {
                createVenvOutput += data.toString();
                console.error(`venv creation: ${data}`);
            });

            await new Promise((resolve, reject) => {
                createVenvProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve(void 0);
                    } else {
                        reject(new Error(`Failed to create virtual environment, exit code: ${code}\nOutput: ${createVenvOutput}`));
                    }
                });

                createVenvProcess.on('error', (error) => {
                    reject(new Error(`Failed to spawn venv creation process: ${error.message}`));
                });
            });

            if (!fs.existsSync(venvPythonPath)) {
                throw new Error('Virtual environment created but Python executable not found');
            }

            // Install dependencies from requirements.txt
            const requirementsPath = path.join(extensionPath, 'requirements.txt');

            // Check for requirements.txt in extension directory first (packaged version)
            if (!fs.existsSync(requirementsPath)) {
                console.warn('No requirements.txt found, proceeding without installing dependencies');
                return venvPythonPath;
            }

            console.log('Installing Python dependencies...');
            vscode.window.showInformationMessage('Installing Python dependencies for Conan extension...');

            // Use the first available requirements.txt
            console.log(`Using requirements file: ${requirementsPath}`);

            const installProcess = cp.spawn(venvPythonPath, ['-m', 'pip', 'install', '-r', requirementsPath], {
                stdio: 'pipe',
                env: { ...process.env }
            });

            let installOutput = '';
            installProcess.stdout?.on('data', (data) => {
                installOutput += data.toString();
                console.log(`pip install: ${data}`);
            });

            installProcess.stderr?.on('data', (data) => {
                installOutput += data.toString();
                console.error(`pip install error: ${data}`);
            });

            await new Promise((resolve, reject) => {
                installProcess.on('close', (code) => {
                    if (code === 0) {
                        console.log('Dependencies installed successfully');
                        vscode.window.showInformationMessage('Python dependencies installed successfully!');
                        resolve(void 0);
                    } else {
                        reject(new Error(`Failed to install dependencies, exit code: ${code}\nOutput: ${installOutput}`));
                    }
                });

                installProcess.on('error', (error) => {
                    reject(new Error(`Failed to spawn pip install process: ${error.message}`));
                });
            });

            return venvPythonPath;
        } catch (error) {
            console.error('Error setting up virtual environment:', error);

            // Provide more specific error messages
            let errorMessage = 'Failed to setup Python environment';
            if (error instanceof Error) {
                if (error.message.includes('venv')) {
                    errorMessage = 'Failed to create Python virtual environment. Ensure Python venv module is available.';
                } else if (error.message.includes('pip install')) {
                    errorMessage = 'Failed to install Python dependencies. Check your internet connection and Python setup.';
                } else {
                    errorMessage = `Failed to setup Python environment: ${error.message}`;
                }
            }

            vscode.window.showErrorMessage(errorMessage);
            return null;
        }
    }

    async startServer(workspacePath: string, extensionPath: string): Promise<boolean> {
        if (this.isServerRunning) {
            return true;
        }

        try {
            this.pythonApi = await PythonExtension.api();

            // Get the effective Python executable path (venv or system)
            const executablePath = this.pythonApi.environments.getActiveEnvironmentPath();
            if (!executablePath) {
                vscode.window.showErrorMessage('No Python executable found. Please ensure Python is properly configured.');
                return false;
            }

            // Setup virtual environment and get venv Python executable
            const venvPythonPath = await this.setupVirtualEnvironment(extensionPath, executablePath.path);
            if (!venvPythonPath) {
                vscode.window.showErrorMessage('Failed to setup virtual environment for Conan extension.');
                return false;
            }

            // Look for server script in extension directory first, then workspace
            let serverScript: string;
            if (extensionPath) {
                // First try the dist directory (for packaged extension)
                const distServerScript = path.join(extensionPath, 'dist', 'conan_server.py');
                if (fs.existsSync(distServerScript)) {
                    serverScript = distServerScript;
                } else {
                    // Then try the root directory (for development)
                    serverScript = path.join(extensionPath, 'conan_server.py');
                }
            } else {
                vscode.window.showErrorMessage('conan_server.py not found. Please ensure the extension is properly installed.');
                return false;
            }

            logger.info(`Starting Conan server with script: ${serverScript}`);
            logger.info(`Using virtual environment Python executable: ${venvPythonPath}`);

            this.serverProcess = cp.spawn(venvPythonPath, [
                serverScript,
                '--host', SERVER_HOST,
                '--port', SERVER_PORT.toString()
            ], {
                cwd: workspacePath,
                stdio: 'pipe',
                env: { ...process.env }
            });

            this.serverProcess.stdout?.on('data', (data) => {
                logger.debug(`Conan Server stdout: ${data.toString().trim()}`);
            });

            this.serverProcess.stderr?.on('data', (data) => {
                logger.error(`Conan Server stderr: ${data.toString().trim()}`);
            });

            this.serverProcess.on('close', (code) => {
                logger.info(`Conan server exited with code ${code}`);
                this.isServerRunning = false;
                this.serverProcess = null;
            });

            // Wait a bit for server to start
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Check if server is responding
            const isRunning = await this.checkServerHealth();
            this.isServerRunning = isRunning;

            return isRunning;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start Conan server: ${error}`);
            return false;
        }
    }

    async stopServer(): Promise<void> {
        if (this.serverProcess) {
            this.serverProcess.kill();
            this.serverProcess = null;
        }
        this.isServerRunning = false;
        // Note: We keep the venv directory for reuse in future sessions
        // this.venvPath = null; // Commented out to reuse venv
    }

    async checkServerHealth(): Promise<boolean> {
        return new Promise((resolve) => {
            const req = http.get(`${SERVER_URL}/health`, (res) => {
                resolve(res.statusCode === 200);
            });

            req.on('error', () => {
                resolve(false);
            });

            req.setTimeout(5000, () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    getServerRunning(): boolean {
        return this.isServerRunning;
    }

    // Method to mark server as running (useful when detecting existing server)
    setServerRunning(running: boolean): void {
        this.isServerRunning = running;
    }

    // Get the virtual environment path if available
    getVirtualEnvironmentPath(): string | null {
        return this.venvPath;
    }

    // Clean up virtual environment (useful for troubleshooting)
    async cleanupVirtualEnvironment(): Promise<boolean> {
        if (!this.venvPath || !fs.existsSync(this.venvPath)) {
            return true;
        }

        try {
            console.log(`Removing virtual environment: ${this.venvPath}`);
            fs.rmSync(this.venvPath, { recursive: true, force: true });
            this.venvPath = null;
            return true;
        } catch (error) {
            console.error('Failed to cleanup virtual environment:', error);
            return false;
        }
    }
}

// HTTP client for server communication
class ConanApiClient {
    async makeRequest(endpoint: string, method: string = 'GET', data?: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, SERVER_URL);
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            const req = http.request(options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(responseData);
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(jsonData);
                        } else {
                            reject(new Error(jsonData.detail || 'Server error'));
                        }
                    } catch (error) {
                        reject(new Error('Invalid JSON response'));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            if (data) {
                req.write(JSON.stringify(data));
            }

            req.end();
        });
    }

    async getPackages(workspacePath: string): Promise<PackageInfo[]> {
        return this.makeRequest(`/packages?workspace_path=${encodeURIComponent(workspacePath)}&host_profile=${encodeURIComponent(activeHostProfile)}&build_profile=${encodeURIComponent(activeBuildProfile)}`);
    }

    async getPackagesForRemote(workspacePath: string, remoteName: string): Promise<PackageInfo[]> {
        return this.makeRequest(`/packages?workspace_path=${encodeURIComponent(workspacePath)}&remote=${encodeURIComponent(remoteName)}&host_profile=${encodeURIComponent(activeHostProfile)}&build_profile=${encodeURIComponent(activeBuildProfile)}`);
    }

    async getProfiles(): Promise<Profile[]> {
        return this.makeRequest('/profiles');
    }

    async getRemotes(): Promise<Remote[]> {
        return this.makeRequest('/remotes');
    }

    async installPackages(workspacePath: string, buildMissing: boolean = true, hostProfile: string, buildProfile: string): Promise<any> {
        return this.makeRequest('/install', 'POST', {
            workspace_path: workspacePath,
            build_missing: buildMissing,
            host_profile: hostProfile,
            build_profile: buildProfile
        });
    }

    async installPackage(packageRef: string, buildMissing: boolean = true, hostProfile: string, buildProfile: string, force: boolean = false): Promise<any> {
        return this.makeRequest('/install/package', 'POST', {
            package_ref: packageRef,
            build_missing: buildMissing,
            host_profile: hostProfile,
            build_profile: buildProfile,
            force: force
        });
    }

    async createProfile(name: string): Promise<any> {
        return this.makeRequest('/profiles/create', 'POST', {
            name: name,
            detect: true
        });
    }

    async addRemote(name: string, url: string): Promise<any> {
        return this.makeRequest('/remotes/add', 'POST', {
            name: name,
            url: url,
            verify_ssl: true
        });
    }

    async uploadMissingPackages(workspacePath: string, remoteName: string, packages: string[] = [], force: boolean = false): Promise<any> {
        return this.makeRequest('/upload/missing', 'POST', {
            workspace_path: workspacePath,
            remote_name: remoteName,
            packages: packages,
            host_profile: activeHostProfile,
            build_profile: activeBuildProfile,
            force: force
        });
    }

    async uploadLocalPackage(packageRef: string, remoteName: string, force: boolean = false): Promise<any> {
        return this.makeRequest('/upload/local', 'POST', {
            package_ref: packageRef,
            remote_name: remoteName,
            host_profile: activeHostProfile,
            build_profile: activeBuildProfile,
            force: force
        });
    }

    async getUploadStatus(): Promise<any> {
        return this.makeRequest('/upload/status');
    }

}

// Tree data providers
class ConanPackageProvider implements vscode.TreeDataProvider<ConanItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ConanItem | undefined | null | void> = new vscode.EventEmitter<ConanItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ConanItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private workspaceRoot: string, private apiClient: ConanApiClient, private serverManager: ConanServerManager) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConanItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConanItem): Thenable<ConanItem[]> {
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage('No Conan packages in empty workspace');
            return Promise.resolve([]);
        }

        if (element) {
            return Promise.resolve([]);
        } else {
            return this.getConanPackages();
        }
    }

    // Removed file parsing methods - all Conan operations delegated to backend API

    private async getConanPackages(): Promise<ConanItem[]> {
        // Always try API first - if server is not running, show message to start it
        if (this.serverManager.getServerRunning()) {
            try {
                let packages: PackageInfo[];

                // Use remote-specific endpoint if active remote is set and not "all"
                if (activeRemote && activeRemote !== 'all') {
                    packages = await this.apiClient.getPackagesForRemote(this.workspaceRoot, activeRemote);
                } else {
                    packages = await this.apiClient.getPackages(this.workspaceRoot);
                }

                return packages.map(pkg => {
                    // Use the simplified availability model with enhanced remote checking
                    let itemType: ItemType = 'package';

                    const availability = pkg.availability;

                    // Determine icon based on availability
                    if (availability.is_incompatible) {
                        itemType = 'package-incompatible';
                    } else {
                        // Check if package also exists remotely
                        if (availability.local_status === 'recipe+binary' && availability.remote_status === 'recipe+binary') {
                            itemType = 'package-available'; // Package available both remotely and locally
                        } else if (availability.local_status === 'recipe+binary' && availability.remote_status !== 'recipe+binary') {
                            itemType = 'package-uploadable'; // Package available for upload
                        } else if (availability.remote_status === 'recipe+binary' && availability.local_status !== 'recipe+binary') {
                            itemType = 'package-downloadable'; // Package available for download
                        } else if (availability.local_status === 'recipe' || availability.remote_status === 'recipe') {
                            itemType = 'package-buildable'; // Recipe available, can build locally
                        } else {
                            itemType = 'package-unknown';
                        }
                    }

                    return new ConanItem(pkg.ref, vscode.TreeItemCollapsibleState.None, itemType, pkg);
                });
            } catch (error) {
                logger.warn('Package API request failed:', error);

                // Check if the error is about missing profiles
                if (error && typeof error === 'object' && 'message' in error) {
                    const errorMessage = (error as any).message || error.toString();
                    if (errorMessage.includes('select host and build profiles') || errorMessage.includes('profiles are required')) {
                        return [new ConanItem('Please select host and build profiles first', vscode.TreeItemCollapsibleState.None, 'warning')];
                    }
                }

                return [new ConanItem(`API Error: ${error}`, vscode.TreeItemCollapsibleState.None, 'error')];
            }
        } else {
            // Server not running - show helpful message
            return [new ConanItem('Conan API Server is not available.', vscode.TreeItemCollapsibleState.None, 'info')];
        }
    }
}

class ConanProfileProvider implements vscode.TreeDataProvider<ConanItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ConanItem | undefined | null | void> = new vscode.EventEmitter<ConanItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ConanItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private apiClient: ConanApiClient, private serverManager: ConanServerManager) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConanItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConanItem): Thenable<ConanItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            return this.getConanProfiles();
        }
    }

    private async getConanProfiles(): Promise<ConanItem[]> {
        // Always use API - if server is not running, show message to start it
        if (this.serverManager.getServerRunning()) {
            try {
                const profiles = await this.apiClient.getProfiles();
                if (profiles.length === 0) {
                    return [new ConanItem('No profiles found', vscode.TreeItemCollapsibleState.None, 'info')];
                }
                return profiles.map(profile => new ConanItem(profile.name, vscode.TreeItemCollapsibleState.None, 'profile'));
            } catch (error) {
                logger.warn('Profile API request failed:', error);
                return [new ConanItem(`API Error: ${error}`, vscode.TreeItemCollapsibleState.None, 'error')];
            }
        } else {
            // Server not running - show helpful message
            return [new ConanItem('Conan API Server is not available.', vscode.TreeItemCollapsibleState.None, 'info')];
        }
    }
}

class ConanRemoteProvider implements vscode.TreeDataProvider<ConanItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ConanItem | undefined | null | void> = new vscode.EventEmitter<ConanItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ConanItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private apiClient: ConanApiClient, private serverManager: ConanServerManager) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConanItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConanItem): Thenable<ConanItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            return this.getConanRemotes();
        }
    }

    private async getConanRemotes(): Promise<ConanItem[]> {
        // Always use API - if server is not running, show message to start it
        if (this.serverManager.getServerRunning()) {
            try {
                const remotes = await this.apiClient.getRemotes();
                if (remotes.length === 0) {
                    return [new ConanItem('No remotes configured', vscode.TreeItemCollapsibleState.None, 'info')];
                }
                return remotes.map(remote =>
                    new ConanItem(`${remote.name} (${remote.url})`, vscode.TreeItemCollapsibleState.None, 'remote')
                );
            } catch (error) {
                logger.warn('Remote API request failed:', error);
                return [new ConanItem(`API Error: ${error}`, vscode.TreeItemCollapsibleState.None, 'error')];
            }
        } else {
            // Server not running - show helpful message
            return [new ConanItem('Conan API Server is not available.', vscode.TreeItemCollapsibleState.None, 'info')];
        }
    }
}

class ConanItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemType: ItemType,
        public readonly packageInfo?: PackageInfo
    ) {
        super(label, collapsibleState);

        // Create detailed tooltip for packages with availability information
        if (itemType.startsWith('package') && packageInfo && packageInfo.availability) {
            const avail = packageInfo.availability;
            let tooltip = `${this.label}\n\n`;

            // Local availability
            tooltip += `📁 Local:\n`;
            tooltip += `\t🔨 Recipe: ${avail.local_status.startsWith('recipe') ? '✅' : '❌'}\n`;
            tooltip += `\t📦 Binary: ${avail.local_status === 'recipe+binary' ? '✅' : '❌'}\n`;

            // Enhanced remote availability info
            tooltip += `🌐 Remote:\n`;
            tooltip += `\t🔨 Recipe: ${avail.remote_status.startsWith('recipe') ? '✅' : '❌'}\n`;
            tooltip += `\t📦 Binary: ${avail.remote_status === 'recipe+binary' ? '✅' : '❌'}\n`;

            // Only show incompatible warning if it's actually incompatible
            if (avail.is_incompatible) {
                tooltip += `⚠️ Package is incompatible with current profile\n`;
            }

            this.tooltip = tooltip;
        } else {
            this.tooltip = this.label;
        }

        // Set context value for package items to enable context menu
        if (itemType.startsWith('package') && packageInfo) {
            this.contextValue = itemType; // Use itemType directly for context value
        }

        switch (itemType) {
            // Icons for the simplified availability model
            case 'package-available':
                this.iconPath = new vscode.ThemeIcon('layers-active');
                this.tooltip += ' (available)';
                break;
            case 'package-uploadable':
                this.iconPath = new vscode.ThemeIcon('layers-dot');
                this.tooltip += ' (available for upload)';
                break;
            case 'package-downloadable':
                this.iconPath = new vscode.ThemeIcon('cloud-download');
                this.tooltip += ' (available for download)';
                break;
            case 'package-buildable':
                this.iconPath = new vscode.ThemeIcon('tools');
                this.tooltip += ' (buildable from recipe)';
                break;
            case 'package-incompatible':
                this.iconPath = new vscode.ThemeIcon('error');
                this.tooltip += ' (incompatible with current profile)';
                break;
            case 'package-unknown':
                this.iconPath = new vscode.ThemeIcon('question');
                this.tooltip += ' (status unknown)';
                break;

            // Non-package item types
            case 'package':
                this.iconPath = new vscode.ThemeIcon('package');
                break;
            case 'profile':
                this.iconPath = new vscode.ThemeIcon('person');
                break;
            case 'remote':
                this.iconPath = new vscode.ThemeIcon('globe');
                break;
            case 'info':
                this.iconPath = new vscode.ThemeIcon('info');
                break;
            case 'error':
                this.iconPath = new vscode.ThemeIcon('error');
                break;
            case 'warning':
                this.iconPath = new vscode.ThemeIcon('warning');
                break;
        }
    }
}

// Removed ConanWebviewPanel class - keeping only sidebar panel and status bar functionality

// Profile status bar management
// Host Profile status bar management
function createHostProfileStatusBarItem(): vscode.StatusBarItem {
    hostProfileStatusBarItem = vscode.window.createStatusBarItem('conan.hostProfile', vscode.StatusBarAlignment.Left, 42);
    hostProfileStatusBarItem.name = 'Conan Host Profile';
    hostProfileStatusBarItem.command = 'conan.selectHostProfile';
    hostProfileStatusBarItem.tooltip = 'Click to select active Conan host profile';
    updateHostProfileStatusBar();
    hostProfileStatusBarItem.show();
    return hostProfileStatusBarItem;
}

function updateHostProfileStatusBar() {
    if (hostProfileStatusBarItem) {
        hostProfileStatusBarItem.text = `$(person) Host: ${activeHostProfile}`;
        hostProfileStatusBarItem.tooltip = `Active Conan Host Profile: ${activeHostProfile} (click to change)`;
    }
}

// Build Profile status bar management  
function createBuildProfileStatusBarItem(): vscode.StatusBarItem {
    buildProfileStatusBarItem = vscode.window.createStatusBarItem('conan.buildProfile', vscode.StatusBarAlignment.Left, 41);
    buildProfileStatusBarItem.name = 'Conan Build Profile';
    buildProfileStatusBarItem.command = 'conan.selectBuildProfile';
    buildProfileStatusBarItem.tooltip = 'Click to select active Conan build profile';
    updateBuildProfileStatusBar();
    buildProfileStatusBarItem.show();
    return buildProfileStatusBarItem;
}

function updateBuildProfileStatusBar() {
    if (buildProfileStatusBarItem) {
        buildProfileStatusBarItem.text = `$(tools) Build: ${activeBuildProfile}`;
        buildProfileStatusBarItem.tooltip = `Active Conan Build Profile: ${activeBuildProfile} (click to change)`;
    }
}

async function selectHostProfile(apiClient: ConanApiClient, serverManager: ConanServerManager): Promise<void> {
    await selectProfile(apiClient, serverManager, 'host');
}

async function selectBuildProfile(apiClient: ConanApiClient, serverManager: ConanServerManager): Promise<void> {
    await selectProfile(apiClient, serverManager, 'build');
}

async function selectProfile(apiClient: ConanApiClient, serverManager: ConanServerManager, profileType: 'host' | 'build'): Promise<void> {
    try {
        // Always use API - require server to be running
        if (!serverManager.getServerRunning()) {
            vscode.window.showErrorMessage('Conan API Server is not available.');
            return;
        }

        let profiles: string[] = [];

        try {
            const apiProfiles = await apiClient.getProfiles();
            profiles = apiProfiles.map(p => p.name);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to get profiles from API: ${error}`);
            return;
        }

        if (profiles.length === 0) {
            const create = await vscode.window.showInformationMessage(
                'No profiles found. Create a default profile?',
                'Create Profile',
                'Cancel'
            );

            if (create === 'Create Profile') {
                await vscode.commands.executeCommand('conan.createProfile');
            }
            return;
        }

        const currentProfile = profileType === 'host' ? activeHostProfile : activeBuildProfile;

        // Show quick pick with current profile highlighted
        const quickPickItems = profiles.map(profile => ({
            label: profile,
            description: profile === currentProfile ? '$(check) Current' : '',
            profile: profile
        }));

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: `Select active Conan ${profileType} profile`,
            matchOnDescription: true
        });

        if (selected && selected.profile !== currentProfile) {
            if (profileType === 'host') {
                activeHostProfile = selected.profile;
                updateHostProfileStatusBar();

                // Store the selection in workspace state
                await vscode.workspace.getConfiguration('conan').update('activeHostProfile', activeHostProfile, vscode.ConfigurationTarget.Workspace);
            } else {
                activeBuildProfile = selected.profile;
                updateBuildProfileStatusBar();

                // Store the selection in workspace state
                await vscode.workspace.getConfiguration('conan').update('activeBuildProfile', activeBuildProfile, vscode.ConfigurationTarget.Workspace);
            }

            vscode.window.showInformationMessage(`Active Conan ${profileType} profile set to: ${selected.profile}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to select ${profileType} profile: ${error}`);
    }
}

// Remote status bar management
function createRemoteStatusBarItem(): vscode.StatusBarItem {
    remoteStatusBarItem = vscode.window.createStatusBarItem('conan.remote', vscode.StatusBarAlignment.Left, 40);
    remoteStatusBarItem.name = 'Conan Remote';
    remoteStatusBarItem.command = 'conan.selectRemote';
    remoteStatusBarItem.tooltip = 'Click to select active Conan remote';
    updateRemoteStatusBar();
    remoteStatusBarItem.show();
    return remoteStatusBarItem;
}

function updateRemoteStatusBar() {
    if (remoteStatusBarItem) {
        remoteStatusBarItem.text = `$(globe) ${activeRemote}`;
        remoteStatusBarItem.tooltip = `Active Conan Remote: ${activeRemote} (click to change)`;
    }
}

async function selectRemote(apiClient: ConanApiClient, serverManager: ConanServerManager, packageProvider: ConanPackageProvider): Promise<void> {
    try {
        // Always use API - require server to be running
        if (!serverManager.getServerRunning()) {
            vscode.window.showErrorMessage('Conan API Server is not available.');
            return;
        }

        let remotes: Remote[] = [];

        try {
            remotes = await apiClient.getRemotes();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to get remotes from API: ${error}`);
            return;
        }

        // Add "all" option
        const remoteOptions = [
            { name: 'all', url: 'All configured remotes' },
            ...remotes
        ];

        // Show quick pick with current remote highlighted
        const quickPickItems = remoteOptions.map(remote => ({
            label: remote.name,
            description: remote.name === activeRemote ? '$(check) Current' : remote.url,
            remote: remote.name
        }));

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select active Conan remote',
            matchOnDescription: true
        });

        if (selected && selected.remote !== activeRemote) {
            activeRemote = selected.remote;
            updateRemoteStatusBar();

            // Refresh package provider to update binary status for new remote
            packageProvider.refresh();

            vscode.window.showInformationMessage(`Active Conan remote set to: ${activeRemote}`);

            // Store the selection in workspace state
            await vscode.workspace.getConfiguration('conan').update('activeRemote', activeRemote, vscode.ConfigurationTarget.Workspace);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to select remote: ${error}`);
    }
}

// Check for existing server at startup and start if needed
async function ensureServerRunning(serverManager: ConanServerManager, workspaceRoot: string, extensionPath: string): Promise<void> {
    try {
        logger.info('Checking for existing Conan API server...');
        const isHealthy = await serverManager.checkServerHealth();

        if (isHealthy) {
            // Server is already running - mark it as running in our state
            serverManager.setServerRunning(true);
            logger.info('Detected existing Conan API server running');
        } else {
            logger.info('No existing Conan API server detected, starting new instance...');
            const success = await serverManager.startServer(workspaceRoot, extensionPath);

            if (success) {
                logger.info('Conan API server started successfully');
            } else {
                logger.error('Failed to start Conan API server');
                vscode.window.showWarningMessage(
                    'Failed to start Conan API server.'
                );
            }
        }
    } catch (error) {
        console.log('Error ensuring server is running:', error);
        vscode.window.showWarningMessage(
            'Unable to start Conan API server. Some features may not be available.'
        );
    }
}

export function activate(context: vscode.ExtensionContext) {
    // Initialize logger first
    logger = vscode.window.createOutputChannel('Conan Package Manager', { log: true });
    context.subscriptions.push(logger);

    logger.info('🚀 Conan Package Manager extension starting...');

    // Initialize server manager and API client
    const serverManager = new ConanServerManager();
    const apiClient = new ConanApiClient();

    // Check if workspace has conanfile
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const hasConanfile = fs.existsSync(path.join(workspaceRoot, 'conanfile.txt')) ||
            fs.existsSync(path.join(workspaceRoot, 'conanfile.py'));

        vscode.commands.executeCommand('setContext', 'workspaceHasConanfile', hasConanfile);

        if (hasConanfile) {
            // Ensure server is running (check for existing or start new)
            ensureServerRunning(serverManager, workspaceRoot, context.extensionPath);
            // Initialize tree data providers with server support
            const packageProvider = new ConanPackageProvider(workspaceRoot, apiClient, serverManager);
            const profileProvider = new ConanProfileProvider(apiClient, serverManager);
            const remoteProvider = new ConanRemoteProvider(apiClient, serverManager);

            // Register tree data providers
            vscode.window.registerTreeDataProvider('conan.packages', packageProvider);
            vscode.window.registerTreeDataProvider('conan.profiles', profileProvider);
            vscode.window.registerTreeDataProvider('conan.remotes', remoteProvider);

            // Register commands
            context.subscriptions.push(
                vscode.commands.registerCommand('conan.installPackages', async () => {
                    logger.info('🔧 Installing all packages...');
                    if (!serverManager.getServerRunning()) {
                        vscode.window.showErrorMessage('Conan API Server is not available.');
                        return;
                    }

                    try {
                        await apiClient.installPackages(
                            workspaceRoot,
                            true,
                            activeHostProfile,
                            activeBuildProfile
                        );
                        logger.info(`✅ Package installation started successfully with profiles: host=${activeHostProfile}, build=${activeBuildProfile}`);
                        vscode.window.showInformationMessage(`Package installation started via API server with profiles: host=${activeHostProfile}, build=${activeBuildProfile}`);
                        // Refresh package view to show updated status
                        packageProvider.refresh();
                    } catch (error) {
                        logger.error(`❌ Package installation failed:`, error);
                        vscode.window.showErrorMessage(`Package installation failed: ${error}`);
                    }
                }),

                vscode.commands.registerCommand('conan.installPackage', async (item?: ConanItem) => {
                    if (!item || !item.packageInfo) {
                        logger.warn('⚠️ No package selected for installation');
                        vscode.window.showErrorMessage('No package selected for installation');
                        return;
                    }

                    if (!serverManager.getServerRunning()) {
                        vscode.window.showErrorMessage('Conan API Server is not available.');
                        return;
                    }

                    const packageRef = item.packageInfo.ref;
                    logger.info(`📦 Installing package: ${packageRef}`);

                    // Show installation options
                    const options = await vscode.window.showQuickPick([
                        { label: 'Install with build if missing', value: { buildMissing: true, force: false } },
                        { label: 'Install (force update)', value: { buildMissing: true, force: true } },
                        { label: 'Install without building', value: { buildMissing: false, force: false } }
                    ], {
                        placeHolder: `Select installation method for ${packageRef}`
                    });

                    if (!options) {
                        return;
                    }

                    try {
                        await apiClient.installPackage(
                            packageRef,
                            options.value.buildMissing,
                            activeHostProfile,
                            activeBuildProfile,
                            options.value.force
                        );
                        vscode.window.showInformationMessage(`Installation of ${packageRef} started via API server with profiles: host=${activeHostProfile}, build=${activeBuildProfile}`);
                        // Refresh package view to show updated status
                        packageProvider.refresh();
                    } catch (error) {
                        vscode.window.showErrorMessage(`Package installation failed: ${error}`);
                    }
                }),

                vscode.commands.registerCommand('conan.createProfile', async () => {
                    if (!serverManager.getServerRunning()) {
                        vscode.window.showErrorMessage('Conan API Server is not available.');
                        return;
                    }

                    const profileName = await vscode.window.showInputBox({
                        prompt: 'Enter profile name',
                        placeHolder: 'e.g., default, debug, release'
                    });

                    if (profileName) {
                        try {
                            await apiClient.createProfile(profileName);
                            vscode.window.showInformationMessage(`Profile '${profileName}' created successfully`);
                            profileProvider.refresh();
                        } catch (error) {
                            vscode.window.showErrorMessage(`Failed to create profile: ${error}`);
                        }
                    }
                }),

                vscode.commands.registerCommand('conan.addRemote', async () => {
                    if (!serverManager.getServerRunning()) {
                        vscode.window.showErrorMessage('Conan API Server is not available.');
                        return;
                    }

                    const remoteName = await vscode.window.showInputBox({
                        prompt: 'Enter remote name',
                        placeHolder: 'e.g., conancenter'
                    });

                    if (remoteName) {
                        const remoteUrl = await vscode.window.showInputBox({
                            prompt: 'Enter remote URL',
                            placeHolder: 'e.g., https://center.conan.io'
                        });

                        if (remoteUrl) {
                            try {
                                await apiClient.addRemote(remoteName, remoteUrl);
                                vscode.window.showInformationMessage(`Remote '${remoteName}' added successfully`);
                                remoteProvider.refresh();
                            } catch (error) {
                                vscode.window.showErrorMessage(`Failed to add remote: ${error}`);
                            }
                        }
                    }
                }),

                vscode.commands.registerCommand('conan.uploadMissingPackages', async () => {
                    if (!serverManager.getServerRunning()) {
                        vscode.window.showErrorMessage('Conan API Server is not available.');
                        return;
                    }

                    const remotes = await apiClient.getRemotes();
                    if (remotes.length === 0) {
                        vscode.window.showErrorMessage('No remotes configured');
                        return;
                    }

                    const remoteItems = remotes.map(r => ({ label: r.name, description: r.url }));
                    const selectedRemote = await vscode.window.showQuickPick(remoteItems, {
                        placeHolder: 'Select remote to upload to'
                    });

                    if (selectedRemote) {
                        try {
                            await apiClient.uploadMissingPackages(workspaceRoot, selectedRemote.label);
                            vscode.window.showInformationMessage('Package upload started. Check the output panel for progress.');

                            // Poll upload status
                            const statusInterval = setInterval(async () => {
                                try {
                                    const status = await apiClient.getUploadStatus();
                                    if (status.status === 'completed') {
                                        vscode.window.showInformationMessage('Package upload completed successfully!');
                                        clearInterval(statusInterval);
                                    } else if (status.status === 'error') {
                                        vscode.window.showErrorMessage('Package upload failed. Check the server logs.');
                                        clearInterval(statusInterval);
                                    }
                                } catch (error) {
                                    clearInterval(statusInterval);
                                }
                            }, 2000);
                        } catch (error) {
                            vscode.window.showErrorMessage(`Failed to start upload: ${error}`);
                        }
                    }
                }),

                vscode.commands.registerCommand('conan.uploadLocalPackage', async (item?: ConanItem) => {
                    if (!serverManager.getServerRunning()) {
                        vscode.window.showErrorMessage('Conan API Server is not available.');
                        return;
                    }

                    if (!item || !item.packageInfo) {
                        vscode.window.showErrorMessage('No package selected for upload');
                        return;
                    }

                    // Check if package has local binaries
                    if (item.packageInfo.availability.local_status !== 'recipe+binary') {
                        vscode.window.showWarningMessage('Package does not have local binaries available for upload');
                        return;
                    }

                    try {
                        // Get available remotes
                        const remotes = await apiClient.getRemotes();

                        if (remotes.length === 0) {
                            vscode.window.showErrorMessage('No remotes configured');
                            return;
                        }

                        // Show remote selection
                        const selectedRemote = await vscode.window.showQuickPick(
                            remotes.map(remote => ({ label: remote.name, description: remote.url })),
                            {
                                placeHolder: 'Select remote to upload to'
                            }
                        );

                        if (selectedRemote) {
                            try {
                                const result = await apiClient.uploadLocalPackage(
                                    item.packageInfo.ref,
                                    selectedRemote.label,
                                    false // force = false
                                );

                                vscode.window.showInformationMessage(result.message);

                                // Refresh package provider to update status
                                packageProvider.refresh();
                            } catch (error) {
                                vscode.window.showErrorMessage(`Failed to upload package: ${error}`);
                            }
                        }
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to get remotes: ${error}`);
                    }
                }),

                vscode.commands.registerCommand('conan.startServer', async () => {
                    if (serverManager.getServerRunning()) {
                        logger.info('ℹ️ Conan API server is already running');
                        vscode.window.showInformationMessage('Conan API server is already running');
                        return;
                    }

                    vscode.window.showInformationMessage('Restarting Conan API server...');
                    const success = await serverManager.startServer(workspaceRoot, context.extensionPath);

                    if (success) {
                        vscode.window.showInformationMessage('Conan API server restarted successfully!');

                        // Refresh all providers to use API
                        packageProvider.refresh();
                        profileProvider.refresh();
                        remoteProvider.refresh();
                    } else {
                        vscode.window.showErrorMessage('Failed to restart Conan API server.');
                    }
                }),

                vscode.commands.registerCommand('conan.stopServer', async () => {
                    if (!serverManager.getServerRunning()) {
                        vscode.window.showInformationMessage('Conan API server is not running');
                        return;
                    }

                    await serverManager.stopServer();
                    vscode.window.showInformationMessage('Conan API server stopped');

                    // Refresh providers to use fallback methods
                    packageProvider.refresh();
                    profileProvider.refresh();
                    remoteProvider.refresh();
                }),

                vscode.commands.registerCommand('conan.refreshPackages', () => packageProvider.refresh()),
                vscode.commands.registerCommand('conan.refreshProfiles', () => profileProvider.refresh()),
                vscode.commands.registerCommand('conan.refreshRemotes', () => remoteProvider.refresh()),

                vscode.commands.registerCommand('conan.selectHostProfile', () => {
                    selectHostProfile(apiClient, serverManager);
                }),

                vscode.commands.registerCommand('conan.selectBuildProfile', () => {
                    selectBuildProfile(apiClient, serverManager);
                }),

                vscode.commands.registerCommand('conan.selectRemote', () => {
                    selectRemote(apiClient, serverManager, packageProvider);
                })
            );

            // Initialize profile status bars
            const hostProfileStatusBar = createHostProfileStatusBarItem();
            context.subscriptions.push(hostProfileStatusBar);

            const buildProfileStatusBar = createBuildProfileStatusBarItem();
            context.subscriptions.push(buildProfileStatusBar);

            // Initialize remote status bar
            const remoteStatusBar = createRemoteStatusBarItem();
            context.subscriptions.push(remoteStatusBar);

            // Load saved active profiles from workspace configuration
            const savedHostProfile = vscode.workspace.getConfiguration('conan').get<string>('activeHostProfile');
            if (savedHostProfile) {
                activeHostProfile = savedHostProfile;
                updateHostProfileStatusBar();
                logger.debug(`Loaded saved host profile: ${activeHostProfile}`);
            } else {
                logger.debug(`Using default host profile: ${activeHostProfile}`);
            }

            const savedBuildProfile = vscode.workspace.getConfiguration('conan').get<string>('activeBuildProfile');
            if (savedBuildProfile) {
                activeBuildProfile = savedBuildProfile;
                updateBuildProfileStatusBar();
                logger.debug(`Loaded saved build profile: ${activeBuildProfile}`);
            } else {
                logger.debug(`Using default build profile: ${activeBuildProfile}`);
            }

            logger.info(`Final profiles after loading: Host=${activeHostProfile}, Build=${activeBuildProfile}`);

            // Load saved active remote from workspace configuration
            const savedRemote = vscode.workspace.getConfiguration('conan').get<string>('activeRemote');
            if (savedRemote) {
                activeRemote = savedRemote;
                updateRemoteStatusBar();
                logger.debug(`Loaded saved remote: ${activeRemote}`);
            } else {
                logger.debug(`Using default remote: ${activeRemote}`);
            }

            // Show welcome message
            vscode.window.showInformationMessage('Conan Package Manager extension activated! 🎉');
        }
    }
}

export function deactivate() { }