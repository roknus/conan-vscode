import * as vscode from 'vscode';
import { ConanServerManager } from './conan_server_manager';
import { initializeLogger } from './logger';
import { detectConanfiles, getConanfileWatchPattern, isConanfileChange } from './conanfile_utils';
import { ConanProject } from './conan_project';

// Global logger instance
let logger: vscode.LogOutputChannel;

async function stopBackend(serverManager: ConanServerManager): Promise<void> {
    if (serverManager.state !== 'running') {
        vscode.window.showInformationMessage('Conan API backend is not running');
        return;
    }

    vscode.commands.executeCommand('setContext', 'conan.backendReady', false);

    await serverManager.stopServer();
    vscode.window.showInformationMessage('Conan API backend stopped');
}

/* 
    * Start the extension functionality
*/
async function startBackend(workspace_path: string, serverManager: ConanServerManager) {

    let serverConnected: Promise<boolean>;
    // Connect to external server or start our own
    if (serverManager.backendUrl) {
        logger.info(`Using external backend URL: ${serverManager.backendUrl}`);
        // Connect to the external server and validate it's running
        serverConnected = serverManager.connectToServer();
    } else {
        // Start our own embedded server
        serverConnected = serverManager.startServer(workspace_path);
    }

    // Update the context for UI visibility
    vscode.commands.executeCommand('setContext', 'conan.backendReady', true);

    await serverConnected;
}

/**
 * Create conanfile watcher for the workspace
 */
function createConanProject(workspaceRoot: string, serverManager: ConanServerManager): vscode.Disposable {

    const disposables: vscode.Disposable[] = [];

    const conanProject = new ConanProject(workspaceRoot, serverManager);

    const watchPattern = getConanfileWatchPattern(workspaceRoot);
    const conanfileWatcher = vscode.workspace.createFileSystemWatcher(watchPattern);
    disposables.push(conanProject, conanfileWatcher,

        conanfileWatcher.onDidCreate(async (uri) => {
            logger.info(`Conanfile created: ${uri.fsPath}`);
            logger.info('🎉 Conanfile detected! Initializing extension...');
            const conanfileInfo = detectConanfiles(workspaceRoot);

            await startBackend(workspaceRoot, serverManager);

            vscode.commands.executeCommand('setContext', 'conan.hasConanfile', conanfileInfo.hasAnyConanfile);
            vscode.commands.executeCommand('setContext', 'conan.producerProject', conanfileInfo.preferredFile?.endsWith('.py'));

            conanProject.activate();

            vscode.window.showInformationMessage(`Conanfile detected (${conanfileInfo.preferredFile})! Conan extension activated.`);
        }),

        conanfileWatcher.onDidChange((uri) => {
            if (isConanfileChange(uri.fsPath)) {
                logger.info(`Conanfile modified: ${uri.fsPath}`); const conanfileInfo = detectConanfiles(workspaceRoot);

                if (!conanfileInfo.hasAnyConanfile) {
                    return;
                }

                vscode.window.showInformationMessage(`Now using ${conanfileInfo.preferredFile} for Conan operations.`);

                conanProject.reload();
            }
        }),

        conanfileWatcher.onDidDelete((uri) => {
            logger.info(`Conanfile deleted: ${uri.fsPath}`);
            logger.info('⚠️ No conanfiles found!');

            vscode.commands.executeCommand('setContext', 'conan.hasConanfile', false);
            conanProject.deactivate();
            stopBackend(serverManager);

            vscode.window.showWarningMessage('All conanfiles removed.');
        })
    );

    (async () => {
        // Start extension if conanfile already exists
        const conanfileInfo = detectConanfiles(workspaceRoot);
        vscode.commands.executeCommand('setContext', 'conan.hasConanfile', conanfileInfo.hasAnyConanfile);
        vscode.commands.executeCommand('setContext', 'conan.producerProject', conanfileInfo.preferredFile?.endsWith('.py'));
        if (conanfileInfo.hasAnyConanfile) {
            await startBackend(workspaceRoot, serverManager);

            conanProject.activate();
        }
    })();

    return vscode.Disposable.from(...disposables);
}

export function activate(context: vscode.ExtensionContext) {
    // Initialize logger first
    logger = vscode.window.createOutputChannel('Conan Package Manager', { log: true });
    context.subscriptions.push(logger);

    // Initialize centralized logger
    initializeLogger(logger);

    logger.info('🚀 Conan Package Manager extension starting...');

    // Check for backend URL in environment variables
    let backendUrl: string | undefined = process.env.CONAN_BACKEND_URL;
    if (backendUrl) {
        try {
            // Validate URL format
            new URL(backendUrl);
            logger.info(`Found backend URL in environment: ${backendUrl}`);
        } catch (error) {
            logger.error(`Invalid backend URL in environment: ${backendUrl}`);
            backendUrl = undefined;
        }
    }

    // Check if workspace has conanfile
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        const serverManager = new ConanServerManager(context.extensionPath, backendUrl);

        // Create conanfile watcher regardless of current state
        // This enables detection of conanfile creation/deletion
        context.subscriptions.push(serverManager,

            createConanProject(workspaceRoot, serverManager)
        );

        // Show welcome message
        vscode.window.showInformationMessage('Conan Package Manager extension activated! 🎉');
    }
}

export function deactivate() {
    logger?.info('🔌 Conan Package Manager extension deactivated');
}