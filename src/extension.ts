import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConanStore, Remote, TaskType } from './conan_store';
import { ConanServerManager } from './conan_server_manager';
import { ConanApiClient } from './conan_api_client';
import { ConanPackageItem } from './tree_data_providers/conan_package_item';
import { ConanRemoteProvider } from './tree_data_providers/conan_remote_provider';
import { ConanProfileProvider } from './tree_data_providers/conan_profile_provider';
import { ConanPackageProvider } from './tree_data_providers/conan_package_provider';
import { ConanProfileItem } from './tree_data_providers/conan_profile_item';
import { initializeLogger } from './logger';

// Global logger instance
let logger: vscode.LogOutputChannel;

type ProfileType = 'host' | 'build';

// Global state for active profiles
let hostProfileStatusBarItem: vscode.StatusBarItem;
let buildProfileStatusBarItem: vscode.StatusBarItem;

// Global state for active remote
let remoteStatusBarItem: vscode.StatusBarItem;

// Profile status bar management
// Host Profile status bar management
function createHostProfileStatusBarItem(): vscode.StatusBarItem {
    hostProfileStatusBarItem = vscode.window.createStatusBarItem('conan.hostProfile', vscode.StatusBarAlignment.Left, 42);
    hostProfileStatusBarItem.name = 'Conan Host Profile';
    hostProfileStatusBarItem.command = 'conan.selectHostProfile';
    hostProfileStatusBarItem.tooltip = 'Click to select active Conan host profile';
    hostProfileStatusBarItem.show();
    return hostProfileStatusBarItem;
}

function updateHostProfileStatusBar(conanStore: ConanStore) {
    if (hostProfileStatusBarItem) {
        let profile = 'None';
        if (conanStore.activeHostProfile) {
            profile = conanStore.activeHostProfile.name;
        }
        hostProfileStatusBarItem.text = `$(person) Host: ${profile}`;
        hostProfileStatusBarItem.tooltip = `Active Conan Host Profile: ${profile} (click to change)`;
    }
}

// Build Profile status bar management  
function createBuildProfileStatusBarItem(): vscode.StatusBarItem {
    buildProfileStatusBarItem = vscode.window.createStatusBarItem('conan.buildProfile', vscode.StatusBarAlignment.Left, 41);
    buildProfileStatusBarItem.name = 'Conan Build Profile';
    buildProfileStatusBarItem.command = 'conan.selectBuildProfile';
    buildProfileStatusBarItem.tooltip = 'Click to select active Conan build profile';
    buildProfileStatusBarItem.show();
    return buildProfileStatusBarItem;
}

function updateBuildProfileStatusBar(conanStore: ConanStore) {
    if (buildProfileStatusBarItem) {
        let profile = 'None';
        if (conanStore.activeBuildProfile) {
            profile = conanStore.activeBuildProfile.name;
        }
        buildProfileStatusBarItem.text = `$(tools) Build: ${profile}`;
        buildProfileStatusBarItem.tooltip = `Active Conan Build Profile: ${profile} (click to change)`;
    }
}

// Remote status bar management
function createRemoteStatusBarItem(): vscode.StatusBarItem {
    remoteStatusBarItem = vscode.window.createStatusBarItem('conan.remote', vscode.StatusBarAlignment.Left, 40);
    remoteStatusBarItem.name = 'Conan Remote';
    remoteStatusBarItem.command = 'conan.selectRemote';
    remoteStatusBarItem.tooltip = 'Click to select active Conan remote';
    remoteStatusBarItem.show();
    return remoteStatusBarItem;
}

function updateRemoteStatusBar(conanStore: ConanStore) {
    if (remoteStatusBarItem) {
        let remote = 'all';
        if (conanStore.activeRemote !== 'all') {
            remote = conanStore.activeRemote.name;
        }
        remoteStatusBarItem.text = `$(globe) ${remote}`;
        remoteStatusBarItem.tooltip = `Active Conan Remote: ${remote} (click to change)`;
    }
}

async function selectProfile(conanStore: ConanStore, profileType: ProfileType): Promise<void> {
    try {
        // Always use API - require server to be running
        if (conanStore.getServerState() !== 'running') {
            vscode.window.showErrorMessage('Conan API Server is not available.');
            return;
        }

        const profiles = conanStore.getProfiles();

        if(!profiles) {
            vscode.window.showErrorMessage('No profiles found. Please create a profile first.');
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

        const currentProfile = profileType === 'host' ? conanStore.activeHostProfile : conanStore.activeBuildProfile;

        // Show quick pick with current profile highlighted
        const quickPickItems = profiles.map(profile => ({
            label: profile.name,
            description: profile === currentProfile ? '$(check) Current' : '',
            profile: profile
        }));

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: `Select active Conan ${profileType} profile`,
            matchOnDescription: true
        });

        if (selected && selected.profile !== currentProfile) {
            if (profileType === 'host') {
                conanStore.activeHostProfile = selected.profile;
                updateHostProfileStatusBar(conanStore);
            } else {
                conanStore.activeBuildProfile = selected.profile;
                updateBuildProfileStatusBar(conanStore);
            }

            vscode.window.showInformationMessage(`Active Conan ${profileType} profile set to: ${selected.profile}`);

            // Save configuration
            await conanStore.saveConfiguration();
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to select ${profileType} profile: ${error}`);
    }
}

async function selectRemote(conanStore: ConanStore): Promise<void> {
    try {
        // Always use API - require server to be running
        if (conanStore.getServerState() !== 'running') {
            vscode.window.showErrorMessage('Conan API Server is not available.');
            return;
        }

        const remotes = conanStore.getRemotes();

        if(!remotes) {
            vscode.window.showErrorMessage('No remotes found. Please add a remote first.');
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
            description: remote.name === conanStore.activeRemote ? '$(check) Current' : remote.url,
            remote: remote
        }));

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select active Conan remote',
            matchOnDescription: true
        });

        if (selected && selected.remote !== conanStore.activeRemote) {
            conanStore.activeRemote = selected.remote;
            updateRemoteStatusBar(conanStore);

            vscode.window.showInformationMessage(`Active Conan remote set to: ${conanStore.activeRemote}`);

            // Save configuration
            await conanStore.saveConfiguration();
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to select remote: ${error}`);
    }
}

async function refreshPackages(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {

    if (conanStore.activeHostProfile === null) {
        vscode.window.showErrorMessage('No active host profile selected. Please select a host profile before refreshing packages.');
        return;
    }

    if (conanStore.activeBuildProfile === null) {
        vscode.window.showErrorMessage('No active build profile selected. Please select a build profile before refreshing packages.');
        return;
    }

    try {
        conanStore.clearPackageCache();
        const packages = await apiClient.getPackages(
            conanStore.workspaceRoot,
            conanStore.activeHostProfile.name,
            conanStore.activeBuildProfile.name,
            conanStore.activeRemote === 'all' ? undefined : conanStore.activeRemote.name);
        conanStore.setPackages(packages);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh packages: ${error}`);
    }
}

async function refreshProfiles(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {
    try {
        conanStore.clearProfileCache();
        const profiles = await apiClient.getProfiles();
        conanStore.setProfiles(profiles);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh profiles: ${error}`);
    }
}

async function refreshRemotes(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {
    try {
        conanStore.clearRemoteCache();
        const remotes = await apiClient.getRemotes();
        conanStore.setRemotes(remotes);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh remotes: ${error}`);
    }
}

async function installAllPackages(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {
    if (conanStore.isTaskRunning()) {
        vscode.window.showWarningMessage('Another operation is in progress. Please wait for it to complete.');
        return;
    }

    if (conanStore.activeHostProfile === null) {
        vscode.window.showErrorMessage('No active host profile selected. Please select a host profile before installing packages.');
        return;
    }

    if (conanStore.activeBuildProfile === null) {
        vscode.window.showErrorMessage('No active build profile selected. Please select a build profile before installing packages.');
        return;
    }

    logger.info('🔧 Installing all packages...');
    if (conanStore.getServerState() !== 'running') {
        vscode.window.showErrorMessage('Conan API Server is not available.');
        return;
    }

    conanStore.setCurrentTask({
        type: TaskType.INSTALL_PACKAGE,
        description: 'Installing all packages'
    });

    try {
        await apiClient.installPackages(
            conanStore.workspaceRoot,
            true,
            conanStore.activeHostProfile.name,
            conanStore.activeBuildProfile.name
        );
        logger.info(`✅ Package installation started successfully with profiles: host=${conanStore.activeHostProfile}, build=${conanStore.activeBuildProfile}`);
        vscode.window.showInformationMessage(`Package installation started via API server with profiles: host=${conanStore.activeHostProfile}, build=${conanStore.activeBuildProfile}`);

    } catch (error) {
        logger.error(`❌ Package installation failed:`, error);
        vscode.window.showErrorMessage(`Package installation failed: ${error}`);
    } finally {
        conanStore.setCurrentTask(null);
    }

    // Clear package status after installation
    refreshPackages(conanStore, apiClient);
}

async function installSinglePackage(conanStore: ConanStore, apiClient: ConanApiClient, item?: ConanPackageItem): Promise<void> {
    if (!item || !item.packageInfo) {
        logger.warn('⚠️ No package selected for installation');
        vscode.window.showErrorMessage('No package selected for installation');
        return;
    }

    if (conanStore.isTaskRunning()) {
        vscode.window.showWarningMessage('Another operation is in progress. Please wait for it to complete.');
        return;
    }

    if (conanStore.getServerState() !== 'running') {
        vscode.window.showErrorMessage('Conan API Server is not available.');
        return;
    }

    if (conanStore.activeHostProfile === null) {
        vscode.window.showErrorMessage('No active host profile selected. Please select a host profile before installing packages.');
        return;
    }

    if (conanStore.activeBuildProfile === null) {
        vscode.window.showErrorMessage('No active build profile selected. Please select a build profile before installing packages.');
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

    conanStore.setCurrentTask({
        type: TaskType.INSTALL_PACKAGE,
        description: `Installing package ${packageRef}`,
        packageRef: packageRef
    });

    try {
        await apiClient.installPackage(
            packageRef,
            options.value.buildMissing,
            conanStore.activeHostProfile.name,
            conanStore.activeBuildProfile.name,
            options.value.force
        );
        vscode.window.showInformationMessage(`Installation of ${packageRef} started via API server with profiles: host=${conanStore.activeHostProfile}, build=${conanStore.activeBuildProfile}`);

    } catch (error) {
        vscode.window.showErrorMessage(`Package installation failed: ${error}`);
    } finally {
        conanStore.setCurrentTask(null);
    }

    // Clear package status after installation
    refreshPackages(conanStore, apiClient);
}

async function createProfile(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {
    if (conanStore.getServerState() !== 'running') {
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
            // Clear profiles cache to force refresh
            conanStore.setProfiles([]);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create profile: ${error}`);
        }
    }

    // Clear profile status after creation
    refreshProfiles(conanStore, apiClient);
}

async function addRemote(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {
    if (conanStore.getServerState() !== 'running') {
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
                // Clear remotes cache to force refresh
                conanStore.setRemotes([]);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to add remote: ${error}`);
            }
        }
    }

    // Clear remotes status after addition
    refreshRemotes(conanStore, apiClient);
}

async function uploadMissingPackages(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {
    if (conanStore.isTaskRunning()) {
        vscode.window.showWarningMessage('Another operation is in progress. Please wait for it to complete.');
        return;
    }

    if (conanStore.getServerState() !== 'running') {
        vscode.window.showErrorMessage('Conan API Server is not available.');
        return;
    }

    const remotes = await apiClient.getRemotes();
    if (remotes.length === 0) {
        vscode.window.showErrorMessage('No remotes configured');
        return;
    }

    if (conanStore.activeHostProfile === null) {
        vscode.window.showErrorMessage('No active host profile selected. Please select a host profile before uploading.');
        return;
    }

    if (conanStore.activeBuildProfile === null) {
        vscode.window.showErrorMessage('No active build profile selected. Please select a build profile before uploading.');
        return;
    }

    const remoteItems = remotes.map(r => ({ label: r.name, description: r.url }));
    const selectedRemote = await vscode.window.showQuickPick(remoteItems, {
        placeHolder: 'Select remote to upload to'
    });

    if (selectedRemote) {
        conanStore.setCurrentTask({
            type: TaskType.UPLOAD_PACKAGE,
            description: `Uploading missing packages to ${selectedRemote.label}`
        });

        try {
            await apiClient.uploadMissingPackages(
                conanStore.workspaceRoot,
                selectedRemote.label,
                conanStore.activeHostProfile.name,
                conanStore.activeBuildProfile.name
            );
            vscode.window.showInformationMessage('Package upload started. Check the output panel for progress.');

            // Poll upload status
            const statusInterval = setInterval(async () => {
                try {
                    const status = await apiClient.getUploadStatus();
                    if (status.status === 'completed') {
                        vscode.window.showInformationMessage('Package upload completed successfully!');
                        clearInterval(statusInterval);
                        conanStore.setCurrentTask(null);
                    } else if (status.status === 'error') {
                        vscode.window.showErrorMessage('Package upload failed. Check the server logs.');
                        clearInterval(statusInterval);
                        conanStore.setCurrentTask(null);
                    }
                } catch (error) {
                    clearInterval(statusInterval);
                    conanStore.setCurrentTask(null);
                }
            }, 2000);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start upload: ${error}`);
            conanStore.setCurrentTask(null);
        }
    }
}

async function uploadLocalPackage(conanStore: ConanStore, apiClient: ConanApiClient, item?: ConanPackageItem): Promise<void> {
    if (conanStore.isTaskRunning()) {
        vscode.window.showWarningMessage('Another operation is in progress. Please wait for it to complete.');
        return;
    }

    if (conanStore.getServerState() !== 'running') {
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

    if (conanStore.activeHostProfile === null) {
        vscode.window.showErrorMessage('No active host profile selected. Please select a host profile before uploading.');
        return;
    }

    try {
        const remotes = conanStore.getRemotes();

        if (!remotes || remotes.length === 0) {
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
            conanStore.setCurrentTask({
                type: TaskType.UPLOAD_PACKAGE,
                description: `Uploading package ${item.packageInfo.ref} to ${selectedRemote.label}`,
                packageRef: item.packageInfo.ref
            });

            try {
                const result = await apiClient.uploadLocalPackage(
                    item.packageInfo.ref,
                    selectedRemote.label,
                    conanStore.activeHostProfile.name,
                    false // force = false
                );

                vscode.window.showInformationMessage(result.message);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to upload package: ${error}`);
            } finally {
                conanStore.setCurrentTask(null);
            }

            // Clear package status after upload
            refreshPackages(conanStore, apiClient);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to get remotes: ${error}`);
    }
}

async function startServer(conanStore: ConanStore, serverManager: ConanServerManager, context: vscode.ExtensionContext): Promise<void> {
    if (conanStore.getServerState() === 'running') {
        logger.info('ℹ️ Conan API server is already running');
        vscode.window.showInformationMessage('Conan API server is already running');
        return;
    }

    vscode.window.showInformationMessage('Restarting Conan API server...');
    const success = await serverManager.startServer(conanStore.workspaceRoot, context.extensionPath);

    if (success) {
        vscode.window.showInformationMessage('Conan API server restarted successfully!');
    } else {
        vscode.window.showErrorMessage('Failed to restart Conan API server.');
    }
}

async function stopServer(conanStore: ConanStore, serverManager: ConanServerManager): Promise<void> {
    if (conanStore.getServerState() !== 'running') {
        vscode.window.showInformationMessage('Conan API server is not running');
        return;
    }

    await serverManager.stopServer();
    vscode.window.showInformationMessage('Conan API server stopped');

    conanStore.clearPackageCache();
}

async function openProfileFile(item?: ConanPackageItem | ConanProfileItem): Promise<void> {
    let resourceUri: vscode.Uri | undefined;
    
    if (item instanceof ConanProfileItem) {
        resourceUri = item.resourceUri;
    } else if (item && item.resourceUri) {
        resourceUri = item.resourceUri;
    }
    
    if (!resourceUri) {
        vscode.window.showErrorMessage('No profile file selected');
        return;
    }

    try {
        await vscode.commands.executeCommand('vscode.open', resourceUri);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to open profile file: ${error}`);
    }
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
        const hasConanfile = fs.existsSync(path.join(workspaceRoot, 'conanfile.txt')) ||
            fs.existsSync(path.join(workspaceRoot, 'conanfile.py'));

        vscode.commands.executeCommand('setContext', 'workspaceHasConanfile', hasConanfile);

        if (hasConanfile) {

            // Initialize centralized store
            const conanStore = new ConanStore();
            conanStore.workspaceRoot = workspaceRoot;

            // Load saved configuration into store
            conanStore.initializeFromConfig();

            const hostProfile = conanStore.activeHostProfile ? conanStore.activeHostProfile.name : 'None';
            const buildProfile = conanStore.activeBuildProfile ? conanStore.activeBuildProfile.name : 'None';
            const remote = conanStore.activeRemote === 'all' ? 'All ' : conanStore.activeRemote.name;
            logger.info(`Final profiles after loading: Host=${hostProfile}, Build=${buildProfile}, Remote=${remote}`);

            // Initialize server manager and API client
            const serverManager = new ConanServerManager(conanStore, backendUrl);
            const apiClient = new ConanApiClient(serverManager);

            let serverConnected: Promise<boolean>;
            // Connect to external server or start our own
            if (serverManager.backendUrl) {
                logger.info(`Using external backend URL: ${serverManager.backendUrl}`);
                // Connect to the external server and validate it's running
                serverConnected = serverManager.connectToServer();
            } else {
                // Start our own embedded server
                serverConnected = serverManager.startServer(workspaceRoot, context.extensionPath);
            }

            serverConnected.then((connected) => {
                if (connected) {
                    refreshPackages(conanStore, apiClient);
                    refreshProfiles(conanStore, apiClient);
                    refreshRemotes(conanStore, apiClient);
                }
            });

            // Initialize tree data providers with server support
            const packageProvider = new ConanPackageProvider(conanStore);
            const profileProvider = new ConanProfileProvider(conanStore);
            const remoteProvider = new ConanRemoteProvider(conanStore);

            // Register tree data providers
            vscode.window.registerTreeDataProvider('conan.packages', packageProvider);
            vscode.window.registerTreeDataProvider('conan.profiles', profileProvider);
            vscode.window.registerTreeDataProvider('conan.remotes', remoteProvider);

            // Register commands
            context.subscriptions.push(
                vscode.commands.registerCommand('conan.installPackages', () => {
                    installAllPackages(conanStore, apiClient);
                }),

                vscode.commands.registerCommand('conan.installPackage', (item?: ConanPackageItem) => {
                    installSinglePackage(conanStore, apiClient, item);
                }),

                vscode.commands.registerCommand('conan.createProfile', () => {
                    createProfile(conanStore, apiClient);
                }),

                vscode.commands.registerCommand('conan.addRemote', () => {
                    addRemote(conanStore, apiClient);
                }),

                vscode.commands.registerCommand('conan.uploadMissingPackages', () => {
                    uploadMissingPackages(conanStore, apiClient);
                }),

                vscode.commands.registerCommand('conan.uploadLocalPackage', (item?: ConanPackageItem) => {
                    uploadLocalPackage(conanStore, apiClient, item);
                }),

                vscode.commands.registerCommand('conan.startServer', () => {
                    startServer(conanStore, serverManager, context);
                }),

                vscode.commands.registerCommand('conan.stopServer', () => {
                    stopServer(conanStore, serverManager);
                }),

                vscode.commands.registerCommand('conan.refreshPackages', () => {
                    refreshPackages(conanStore, apiClient);
                }),

                vscode.commands.registerCommand('conan.refreshProfiles', () => {
                    refreshProfiles(conanStore, apiClient);
                }),

                vscode.commands.registerCommand('conan.refreshRemotes', () => {
                    refreshRemotes(conanStore, apiClient);
                }),

                vscode.commands.registerCommand('conan.selectHostProfile', () => {
                    selectProfile(conanStore, 'host');
                }),

                vscode.commands.registerCommand('conan.selectBuildProfile', () => {
                    selectProfile(conanStore, 'build');
                }),

                vscode.commands.registerCommand('conan.selectRemote', () => {
                    selectRemote(conanStore);
                }),

                vscode.commands.registerCommand('conan.openProfileFile', (item?: ConanPackageItem | ConanProfileItem) => {
                    openProfileFile(item);
                })
            );

            // Initialize status bars
            const hostProfileStatusBar = createHostProfileStatusBarItem();
            context.subscriptions.push(hostProfileStatusBar);

            const buildProfileStatusBar = createBuildProfileStatusBarItem();
            context.subscriptions.push(buildProfileStatusBar);

            const remoteStatusBar = createRemoteStatusBarItem();
            context.subscriptions.push(remoteStatusBar);

            // Update status bars with loaded values from store
            updateHostProfileStatusBar(conanStore);
            updateBuildProfileStatusBar(conanStore);
            updateRemoteStatusBar(conanStore);

            // Show welcome message
            vscode.window.showInformationMessage('Conan Package Manager extension activated! 🎉');
        }
    }
}

export function deactivate() { }