import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { PythonExtension } from '@vscode/python-extension';
import { getLogger } from './logger';

// Server configuration
const SERVER_HOST = '127.0.0.1';

// Server state enumeration
export type ServerState = 'starting' | 'running' | 'stopped' | 'error';

// Server state management
export class ConanServerManager implements vscode.Disposable {
    private serverProcess: cp.ChildProcess | null = null;
    private pythonApi: PythonExtension | null = null;
    private venvPath: string | null = null;
    private serverPort: number = 0;
    public backendUrl: string | null = null;

    private extensionPath: string;
    private _state: ServerState = 'stopped';
    private _onStateChange = new vscode.EventEmitter<ServerState>();
    public readonly onStateChange = this._onStateChange.event;


    get state(): ServerState {
        return this._state;
    }

    constructor(extensionPath: string, backendUrl?: string) {
        this.extensionPath = extensionPath;
        if (backendUrl) {
            this.backendUrl = backendUrl;
            this.logger.info(`Using external backend server: ${backendUrl}`);
        }
    }

    dispose(): void {
        this.stopServer();
    }

    // Notify store of state change
    private notifyStateChange(newState: ServerState): void {
        this.logger.info(`Server state changed to: ${newState}`);
        this._onStateChange.fire(newState);
    }

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

    async startServer(workspace_path: string): Promise<boolean> {

        if (this._state === 'running') {
            return true;
        }

        if (this._state === 'starting') {
            // Already starting, wait for completion
            return new Promise((resolve) => {
                const checkState = () => {
                    if (this._state === 'running') {
                        resolve(true);
                    } else if (this._state === 'error' || this._state === 'stopped') {
                        resolve(false);
                    } else {
                        setTimeout(checkState, 500);
                    }
                };
                checkState();
            });
        }

        this.notifyStateChange('starting');

        // If backend URL is already set, connect to external server
        if (this.backendUrl) {
            return await this.connectToServer();
        }

        // Start our own server
        return await this.startOwnServer(workspace_path, this.extensionPath);
    }

    async connectToServer(): Promise<boolean> {
        if (!this.backendUrl) {
            this.logger.error('No backend URL provided for connection');
            this.notifyStateChange('error');
            return false;
        }

        this.logger.info(`Attempting to connect to external backend: ${this.backendUrl}`);

        try {
            const isHealthy = await this.checkServerHealth();
            if (isHealthy) {
                this.notifyStateChange('running');
                this.logger.info(`Connected to external backend: ${this.backendUrl}`);
                return true;
            } else {
                this.logger.error(`External backend is not responding: ${this.backendUrl}`);
                this.notifyStateChange('error');
                return false;
            }
        } catch (error) {
            this.logger.error(`Failed to connect to external backend: ${error}`);
            this.notifyStateChange('error');
            return false;
        }
    }

    private async startOwnServer(workspacePath: string, extensionPath: string): Promise<boolean> {
        try {
            this.pythonApi = await PythonExtension.api();

            // Get the effective Python executable path (venv or system)
            const executablePath = this.pythonApi.environments.getActiveEnvironmentPath();
            if (!executablePath) {
                vscode.window.showErrorMessage('No Python executable found. Please ensure Python is properly configured.');
                this.notifyStateChange('error');
                return false;
            }

            // Setup virtual environment and get venv Python executable
            const venvPythonPath = await this.setupVirtualEnvironment(extensionPath, executablePath.path);
            if (!venvPythonPath) {
                vscode.window.showErrorMessage('Failed to setup virtual environment for Conan extension.');
                this.notifyStateChange('error');
                return false;
            }

            // Look for server script in extension directory first, then workspace
            let serverScript: string;
            if (extensionPath) {
                // First try the dist directory (for packaged extension)
                const distServerScript = path.join(extensionPath, 'dist', 'backend', 'conan_server.py');
                if (fs.existsSync(distServerScript)) {
                    serverScript = distServerScript;
                } else {
                    // Then try the root directory (for development)
                    serverScript = path.join(extensionPath, 'backend', 'conan_server.py');
                }
            } else {
                vscode.window.showErrorMessage('conan_server.py not found. Please ensure the extension is properly installed.');
                this.notifyStateChange('error');
                return false;
            }

            this.logger.info(`Starting Conan server with script: ${serverScript}`);
            this.logger.info(`Using virtual environment Python executable: ${venvPythonPath}`);

            // Start server with port 0 to get any available port
            this.serverProcess = cp.spawn(venvPythonPath, [
                serverScript,
                '--host', SERVER_HOST,
                '--port', '0'  // Let server choose any available port
            ], {
                cwd: workspacePath, // The backend need to be launched in the workspace folder
                stdio: 'pipe',
                env: { ...process.env }
            });

            // Wait for server to output its port
            const portPromise = new Promise<number>((resolve, reject) => {
                let portReceived = false;
                const timeout = setTimeout(() => {
                    if (!portReceived) {
                        reject(new Error('Timeout waiting for server port'));
                    }
                }, 10000); // 10 second timeout

                this.serverProcess!.stdout?.on('data', (data) => {
                    const output = data.toString();
                    if (this.logger) {
                        this.logger.debug(`Conan Server: ${output.trim()}`);
                    }

                    // Look for port information
                    const portMatch = output.match(/CONAN_SERVER_PORT:(\d+)/);
                    if (portMatch && !portReceived) {
                        portReceived = true;
                        clearTimeout(timeout);
                        const port = parseInt(portMatch[1], 10);
                        resolve(port);
                    }
                });
            });

            this.serverProcess.stderr?.on('data', (data) => {
                if (this.logger) {
                    this.logger.info(`Conan Server: ${data.toString().trim()}`);
                }
            });

            this.serverProcess.on('close', (code) => {
                if (this.logger) {
                    this.logger.info(`Conan server exited with code ${code}`);
                }
                this.notifyStateChange('stopped');
                this.serverProcess = null;
                this.serverPort = 0;
                this.backendUrl = null;
            });

            this.serverProcess.on('error', (error) => {
                if (this.logger) {
                    this.logger.error(`Conan server process error: ${error}`);
                }
                this.notifyStateChange('error');
                this.serverProcess = null;
                this.serverPort = 0;
                this.backendUrl = null;
            });

            // Wait for server to provide its port
            try {
                this.serverPort = await portPromise;
                this.backendUrl = `http://${SERVER_HOST}:${this.serverPort}`;
                if (this.logger) {
                    this.logger.info(`Server started on port ${this.serverPort}`);
                }

                // Wait a bit more for server to fully start
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Check if server is responding
                const isRunning = await this.checkServerHealth();
                if (isRunning) {
                    this.notifyStateChange('running');
                    return true;
                } else {
                    this.notifyStateChange('error');
                    return false;
                }
            } catch (error) {
                if (this.logger) {
                    this.logger.error(`Failed to get server port: ${error}`);
                }
                this.notifyStateChange('error');
                return false;
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start Conan server: ${error}`);
            this.notifyStateChange('error');
            return false;
        }
    }

    async stopServer(): Promise<void> {
        // Only stop our own server process, not external ones
        if (this.serverProcess) {
            this.serverProcess.kill();
            this.serverProcess = null;
            this.serverPort = 0;
            this.backendUrl = null;
            this.notifyStateChange('stopped');
        }
        else {
            if (this.logger) {
                this.logger.info('No server process to stop (external backend in use)');
            }
        }
        // Note: We keep the venv directory for reuse in future sessions
        // this.venvPath = null; // Commented out to reuse venv
    }

    async checkServerHealth(): Promise<boolean> {
        if (!this.backendUrl) {
            return false;
        }
        return new Promise((resolve) => {
            const req = http.get(`${this.backendUrl}/health`, (res) => {
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

    // Method to mark server as running (useful when detecting existing server)
    setServerRunning(running: boolean): void {
        this._onStateChange.fire(running ? 'running' : 'stopped');
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

    private get logger() {
        return getLogger();
    }
}
