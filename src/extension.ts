import * as vscode from 'vscode';
import { ConanStore, Profile, TaskType, ProfileType, Remote, AllRemotes } from './conan_store';
import { ConanServerManager } from './conan_server_manager';
import { ConanApiClient } from './conan_api_client';
import { ConanPackageItem } from './tree_data_providers/conan_package_item';
import { ConanRemoteProvider } from './tree_data_providers/conan_remote_provider';
import { ConanProfileProvider } from './tree_data_providers/conan_profile_provider';
import { ConanPackageProvider } from './tree_data_providers/conan_package_provider';
import { ConanProfileItem } from './tree_data_providers/conan_profile_item';
import { initializeLogger } from './logger';
import { detectConanfiles, getConanfileWatchPattern, isConanfileChange } from './conanfile_utils';
import { ProfileFolderWatcherService, ProfileFolderChangeEvent } from './services/profile_folder_watcher_service';
import { ActiveProfileWatcherService, ActiveProfileChangeEvent } from './services/active_profile_watcher_service';

// Global logger instance
let logger: vscode.LogOutputChannel;

interface StatusBarItems {
    hostProfile: vscode.StatusBarItem;
    buildProfile: vscode.StatusBarItem;
    remote: vscode.StatusBarItem;
}

// Global state for conanfile watcher
let conanfileWatcher: vscode.FileSystemWatcher | undefined;

// Profile folder watcher service
let profileFolderWatcherService: ProfileFolderWatcherService | undefined;

// Active profile watcher service
let activeProfileWatcherService: ActiveProfileWatcherService | undefined;

/**
 * QuickPickItem that stores the actual setting value alongside display information
 */
export interface SettingQuickPickItem extends vscode.QuickPickItem {
    // Store the actual value to use when setting the profile
    value?: string;
}

/**
 * QuickPickItem that stores the actual profile alongside display information
 */
export interface ProfileQuickPickItem extends vscode.QuickPickItem {
    // Store the actual profile object
    profile?: Profile;
}

// Profile status bar management
// Host Profile status bar management
function createProfileStatusBarItem(type: ProfileType): vscode.StatusBarItem {
    if (type === 'host') {
        const hostProfileStatusBarItem = vscode.window.createStatusBarItem('conan.hostProfile', vscode.StatusBarAlignment.Left, 42);
        hostProfileStatusBarItem.name = 'Conan Host Profile';
        hostProfileStatusBarItem.command = 'conan.selectHostProfile';
        hostProfileStatusBarItem.tooltip = 'Click to select active Conan host profile';
        return hostProfileStatusBarItem;
    } else {
        const buildProfileStatusBarItem = vscode.window.createStatusBarItem('conan.buildProfile', vscode.StatusBarAlignment.Left, 41);
        buildProfileStatusBarItem.name = 'Conan Build Profile';
        buildProfileStatusBarItem.command = 'conan.selectBuildProfile';
        buildProfileStatusBarItem.tooltip = 'Click to select active Conan build profile';
        return buildProfileStatusBarItem;
    }
}

function updateProfileStatusBar(statusBarItem: vscode.StatusBarItem, profileType: ProfileType, profile: Profile | null) {
    if (statusBarItem) {
        let profileName = 'None';
        if (profile) {
            profileName = profile.name;
        }
        if (profileType === 'host') {
            statusBarItem.text = `$(person) Host: ${profileName}`;
            statusBarItem.tooltip = `Active Conan Host Profile: ${profileName} (click to change)`;
        }
        else if (profileType === 'build') {
            statusBarItem.text = `$(tools) Build: ${profileName}`;
            statusBarItem.tooltip = `Active Conan Build Profile: ${profileName} (click to change)`;
        }
    }
}

// Remote status bar management
function createRemoteStatusBarItem(): vscode.StatusBarItem {
    const remoteStatusBarItem = vscode.window.createStatusBarItem('conan.remote', vscode.StatusBarAlignment.Left, 40);
    remoteStatusBarItem.name = 'Conan Remote';
    remoteStatusBarItem.command = 'conan.selectRemote';
    remoteStatusBarItem.tooltip = 'Click to select active Conan remote';
    return remoteStatusBarItem;
}

function updateRemoteStatusBar(statusBarItem: vscode.StatusBarItem, remote: Remote | AllRemotes) {
    if (statusBarItem) {
        let remoteName = 'all';
        if (remote !== 'all') {
            remoteName = remote.name;
        }
        statusBarItem.text = `$(globe) ${remoteName}`;
        statusBarItem.tooltip = `Active Conan Remote: ${remoteName} (click to change)`;
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

        if (!profiles) {
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

        const quickPickItems: ProfileQuickPickItem[] = [];
        const globalProfiles = profiles.filter(profile => !profile.isLocal);
        if (globalProfiles.length > 0) {
            quickPickItems.push({ label: 'Global Profiles', kind: vscode.QuickPickItemKind.Separator });
            quickPickItems.push(...globalProfiles.map(profile => ({
                label: profile.name,
                description: profile === currentProfile ? '$(check) Current' : '',
                profile: profile
            })));
        }
        const localProfiles = profiles.filter(profile => profile.isLocal);
        if (localProfiles.length > 0) {
            quickPickItems.push({ label: 'Local Profiles', kind: vscode.QuickPickItemKind.Separator });
            quickPickItems.push(...localProfiles.map(profile => ({
                label: profile.name,
                description: profile === currentProfile ? '$(check) Current' : '',
                profile: profile
            })));
        }

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: `Select active Conan ${profileType} profile`,
            matchOnDescription: true
        });

        if (selected && selected.profile && selected.profile !== currentProfile) {
            if (profileType === 'host') {
                conanStore.activeHostProfile = selected.profile;
            } else {
                conanStore.activeBuildProfile = selected.profile;
            }

            vscode.window.showInformationMessage(`Active Conan ${profileType} profile set to: ${selected.profile.name}`);

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

        if (!remotes) {
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
            conanStore.activeHostProfile.path,
            conanStore.activeBuildProfile.path,
            conanStore.activeRemote === 'all' ? undefined : conanStore.activeRemote.name);
        conanStore.setPackages(packages);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh packages: ${error}`);
    }
}

async function refreshProfiles(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {
    try {
        conanStore.clearProfileCache();

        // Get local profiles path from configuration
        const config = vscode.workspace.getConfiguration('conan');
        const localProfilesPath = config.get<string>('localProfilesPath', '.conan2/profiles');

        // Make path absolute relative to workspace root
        const workspaceRoot = conanStore.workspaceRoot;
        const absoluteLocalProfilesPath = localProfilesPath.startsWith('.') ?
            `${workspaceRoot}/${localProfilesPath}` : localProfilesPath;

        const profiles = await apiClient.getProfiles(absoluteLocalProfilesPath);
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
            conanStore.activeHostProfile.path,
            conanStore.activeBuildProfile.path
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
            conanStore.activeHostProfile.path,
            conanStore.activeBuildProfile.path,
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

    // First ask for profile type
    const profileType = await vscode.window.showQuickPick([
        { label: 'Global Profile', description: 'Available to all Conan projects', value: 'global' },
        { label: 'Local Profile', description: 'Only available to this workspace', value: 'local' }
    ], {
        placeHolder: 'Select profile type'
    });

    if (!profileType) {
        return;
    }

    const profileName = await vscode.window.showInputBox({
        prompt: 'Enter profile name',
        placeHolder: 'e.g., default, debug, release'
    });

    if (!profileName) {
        return;
    }

    // Check if profile already exists using cached profiles
    const existingProfiles = conanStore.getProfiles();
    if (existingProfiles) {
        const isLocal = profileType.value === 'local';
        const existingProfile = existingProfiles.find(p =>
            p.name === profileName && p.isLocal === isLocal
        );

        if (existingProfile) {
            const overwrite = await vscode.window.showWarningMessage(
                `Profile '${profileName}' already exists. Do you want to overwrite it?`,
                'Overwrite',
                'Cancel'
            );

            if (overwrite !== 'Overwrite') {
                return;
            }
        }
    }

    // Get local profiles path if creating a local profile
    let profilePath: string | undefined;
    if (profileType.value === 'local') {
        const config = vscode.workspace.getConfiguration('conan');
        profilePath = config.get<string>('localProfilesPath', '.conan2/profiles');
    }

    try {
        // Get available settings from Conan
        const settings = await apiClient.getSettings();

        // Prompt user for each setting
        const profileSettings: { [key: string]: string | null } = {};

        // Helper function to show QuickPick with skip option
        const showSettingQuickPick = async (settingKey: string, options: string[]): Promise<string | null | undefined> => {
            const settingOptions: SettingQuickPickItem[] = options.map(val => ({
                label: val ? val : 'None',  // Handle null values
                value: val
            }));

            // Add skip option at the beginning
            settingOptions.unshift({
                label: 'Skip',
                description: 'Let Conan decide the value automatically',
                value: undefined  // Use undefined to indicate skip
            });

            const selected = await vscode.window.showQuickPick(settingOptions, {
                placeHolder: `Select ${settingKey}`,
                canPickMany: false
            });

            return selected?.value;
        };

        // Recursive function to parse nested settings
        const parseNestedSettings = async (settingsObject: any, currentPath: string[]): Promise<void> => {
            for (const [key, val] of Object.entries(settingsObject)) {
                if (val instanceof Array) {
                    const selectedValue = await showSettingQuickPick(key, val);
                    if (selectedValue !== undefined) {
                        profileSettings[`${currentPath.join('.')}.${key}`] = selectedValue;
                    }
                } else if (val instanceof Object) {
                    await parseNestedSettings(val, currentPath.concat(key));
                }
            }
        };

        // Process top-level settings
        for (const [key, val] of Object.entries(settings)) {
            if (val instanceof Array) {
                const selectedValue = await showSettingQuickPick(key, val);
                if (selectedValue !== undefined) {
                    profileSettings[key] = selectedValue;
                }
            } else if (val instanceof Object) {
                const selectedKey = await showSettingQuickPick(key, Object.keys(val));
                if (selectedKey !== undefined && selectedKey !== null) {
                    profileSettings[key] = selectedKey;
                    await parseNestedSettings(settings[key][selectedKey], [key]);
                }
            }
        }

        // Create profile with collected settings
        await apiClient.createProfile(profileName, profileSettings, profilePath);
        const profileTypeText = profileType.value;
        vscode.window.showInformationMessage(`${profileTypeText.charAt(0).toUpperCase() + profileTypeText.slice(1)} profile '${profileName}' created successfully`);

        // Clear profiles cache to force refresh
        conanStore.setProfiles([]);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create profile: ${error}`);
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
                conanStore.activeHostProfile.path,
                conanStore.activeBuildProfile.path
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
                    conanStore.activeHostProfile.path,
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

/**
 * Create or update file watcher for host profile
 */
function updateHostProfileWatcher(conanStore: ConanStore, apiClient: ConanApiClient) {
    // This function is now handled by ActiveProfileWatcherService
    if (activeProfileWatcherService) {
        activeProfileWatcherService.setHostProfile(conanStore.activeHostProfile);
    }
}

/**
 * Create or update file watcher for build profile
 */
function updateBuildProfileWatcher(conanStore: ConanStore, apiClient: ConanApiClient) {
    // This function is now handled by ActiveProfileWatcherService
    if (activeProfileWatcherService) {
        activeProfileWatcherService.setBuildProfile(conanStore.activeBuildProfile);
    }
}

/* 
    * Start the extension functionality
*/
function start(context: vscode.ExtensionContext, workspaceRoot: string, serverManager: ConanServerManager, conanStore: ConanStore, apiClient: ConanApiClient, statusBarItems: StatusBarItems) {

    // Update the context for UI visibility
    vscode.commands.executeCommand('setContext', 'workspaceHasConanfile', true);

    // Update profile status bar visibility
    statusBarItems.hostProfile.show();
    statusBarItems.buildProfile.show();
    statusBarItems.remote.show();

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

    serverConnected.then(async (connected) => {
        if (connected && conanStore && apiClient) {
            refreshPackages(conanStore, apiClient);
            refreshProfiles(conanStore, apiClient);
            refreshRemotes(conanStore, apiClient);

            // Initialize profile folder watcher service after server is connected
            profileFolderWatcherService = new ProfileFolderWatcherService();

            // Register callback for profile folder changes
            profileFolderWatcherService.onProfileFolderChange((event: ProfileFolderChangeEvent) => {
                refreshProfiles(conanStore, apiClient);
            });

            // Initialize active profile watcher service
            activeProfileWatcherService = new ActiveProfileWatcherService();

            // Register callback for active profile file changes
            activeProfileWatcherService.onActiveProfileChange((event: ActiveProfileChangeEvent) => {
                if (event.type === 'changed') {
                    logger.info(`${event.profileType} profile file changed, refreshing packages`);
                    refreshPackages(conanStore, apiClient);
                } else if (event.type === 'deleted') {
                    if (event.profileType === 'host') {
                        conanStore.activeHostProfile = null;
                        vscode.window.showWarningMessage(`Host profile file was deleted. Active host profile reset to None.`);
                    } else if (event.profileType === 'build') {
                        conanStore.activeBuildProfile = null;
                        vscode.window.showWarningMessage(`Build profile file was deleted. Active build profile reset to None.`);
                    }
                    conanStore.saveConfiguration();
                }
            });

            try {
                // Get global profiles path from the API
                const globalProfilesPath = await apiClient.getConanHome();

                // Get local profiles path from configuration
                const config = vscode.workspace.getConfiguration('conan');
                const localProfilesPath = config.get<string>('localProfilesPath', '.conan2/profiles');
                const absoluteLocalProfilesPath = localProfilesPath.startsWith('.') ?
                    `${workspaceRoot}/${localProfilesPath}` : localProfilesPath;

                // Initialize with both paths
                await profileFolderWatcherService.initialize(`${globalProfilesPath}/profiles`, absoluteLocalProfilesPath);

                // Register the services as disposable resources
                context.subscriptions.push(profileFolderWatcherService);
                context.subscriptions.push(activeProfileWatcherService);
            } catch (error) {
                logger.error('Failed to initialize profile folder watcher service:', error);
            }
        }
    });
}

/*
    * Stop the extension functionality
*/
function stop(serverManager: ConanServerManager, statusBarItems: StatusBarItems) {

    // Update the context for UI visibility
    vscode.commands.executeCommand('setContext', 'workspaceHasConanfile', false);

    // Update profile status bar visibility
    statusBarItems.hostProfile.hide();
    statusBarItems.buildProfile.hide();
    statusBarItems.remote.hide();

    // Dispose profile folder watcher service
    if (profileFolderWatcherService) {
        profileFolderWatcherService.dispose();
        profileFolderWatcherService = undefined;
    }

    // Dispose active profile watcher service
    if (activeProfileWatcherService) {
        activeProfileWatcherService.dispose();
        activeProfileWatcherService = undefined;
    }

    if (!serverManager.backendUrl) {
        serverManager.stopServer();
    }
}

/**
 * Handle conanfile creation (when no conanfile existed before)
 */
function handleConanfileCreated(context: vscode.ExtensionContext, workspaceRoot: string, serverManager: ConanServerManager, conanStore: ConanStore, apiClient: ConanApiClient, statusBarItems: StatusBarItems) {
    logger.info('🎉 Conanfile detected! Initializing extension...');
    const conanfileInfo = detectConanfiles(workspaceRoot);

    start(context, workspaceRoot, serverManager, conanStore, apiClient, statusBarItems);

    vscode.window.showInformationMessage(`Conanfile detected (${conanfileInfo.preferredFile})! Conan extension activated.`);
}

/**
 * Handle conanfile changes (when conanfile content or preference changes)
 */
function handleConanfileChanged(workspaceRoot: string, conanStore: ConanStore, apiClient: ConanApiClient) {
    const conanfileInfo = detectConanfiles(workspaceRoot);

    if (!conanfileInfo.hasAnyConanfile) {
        return;
    }

    vscode.window.showInformationMessage(`Now using ${conanfileInfo.preferredFile} for Conan operations.`);

    // Refresh packages since conanfile content or preference may have changed
    refreshPackages(conanStore, apiClient);
}

/**
 * Handle conanfile deletion (when all conanfiles are removed)
 */
function handleConanfileDeleted(serverManager: ConanServerManager, statusBarItems: StatusBarItems) {
    logger.info('⚠️ No conanfiles found!');

    stop(serverManager, statusBarItems);

    vscode.window.showWarningMessage('All conanfiles removed.');
}

/**
 * Create conanfile watcher for the workspace
 */
function createConanfileWatcher(context: vscode.ExtensionContext, workspaceRoot: string, serverManager: ConanServerManager, conanStore: ConanStore, apiClient: ConanApiClient, statusBarItems: StatusBarItems): vscode.FileSystemWatcher {
    // Dispose existing watcher
    if (conanfileWatcher) {
        conanfileWatcher.dispose();
    }

    const watchPattern = getConanfileWatchPattern(workspaceRoot);
    conanfileWatcher = vscode.workspace.createFileSystemWatcher(watchPattern);

    conanfileWatcher.onDidCreate((uri) => {
        logger.info(`Conanfile created: ${uri.fsPath}`);
        handleConanfileCreated(context, workspaceRoot, serverManager, conanStore, apiClient, statusBarItems);
    });

    conanfileWatcher.onDidChange((uri) => {
        if (isConanfileChange(uri.fsPath)) {
            logger.info(`Conanfile modified: ${uri.fsPath}`);
            handleConanfileChanged(workspaceRoot, conanStore, apiClient);
        }
    });

    conanfileWatcher.onDidDelete((uri) => {
        logger.info(`Conanfile deleted: ${uri.fsPath}`);
        handleConanfileDeleted(serverManager, statusBarItems);
    });

    return conanfileWatcher;
}

/**
 * Register extension commands
 */
function registerCommands(context: vscode.ExtensionContext, conanStore: ConanStore, apiClient: ConanApiClient, serverManager: ConanServerManager) {

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('conan.installPackages', () => {
            if (conanStore && apiClient) {
                installAllPackages(conanStore, apiClient);
            }
        }),

        vscode.commands.registerCommand('conan.installPackage', (item?: ConanPackageItem) => {
            if (conanStore && apiClient) {
                installSinglePackage(conanStore, apiClient, item);
            }
        }),

        vscode.commands.registerCommand('conan.createProfile', () => {
            if (conanStore && apiClient) {
                createProfile(conanStore, apiClient);
            }
        }),

        vscode.commands.registerCommand('conan.addRemote', () => {
            if (conanStore && apiClient) {
                addRemote(conanStore, apiClient);
            }
        }),

        vscode.commands.registerCommand('conan.uploadMissingPackages', () => {
            if (conanStore && apiClient) {
                uploadMissingPackages(conanStore, apiClient);
            }
        }),

        vscode.commands.registerCommand('conan.uploadLocalPackage', (item?: ConanPackageItem) => {
            if (conanStore && apiClient) {
                uploadLocalPackage(conanStore, apiClient, item);
            }
        }),

        vscode.commands.registerCommand('conan.startServer', () => {
            if (conanStore) {
                startServer(conanStore, serverManager, context);
            }
        }),

        vscode.commands.registerCommand('conan.stopServer', () => {
            if (conanStore) {
                stopServer(conanStore, serverManager);
            }
        }),

        vscode.commands.registerCommand('conan.refreshPackages', () => {
            if (conanStore && apiClient) {
                refreshPackages(conanStore, apiClient);
            }
        }),

        vscode.commands.registerCommand('conan.refreshProfiles', () => {
            if (conanStore && apiClient) {
                refreshProfiles(conanStore, apiClient);
            }
        }),

        vscode.commands.registerCommand('conan.refreshRemotes', () => {
            if (conanStore && apiClient) {
                refreshRemotes(conanStore, apiClient);
            }
        }),

        vscode.commands.registerCommand('conan.selectHostProfile', () => {
            if (conanStore) {
                selectProfile(conanStore, 'host');
            }
        }),

        vscode.commands.registerCommand('conan.selectBuildProfile', () => {
            if (conanStore) {
                selectProfile(conanStore, 'build');
            }
        }),

        vscode.commands.registerCommand('conan.selectRemote', () => {
            if (conanStore) {
                selectRemote(conanStore);
            }
        }),

        vscode.commands.registerCommand('conan.openProfileFile', (item?: ConanPackageItem | ConanProfileItem) => {
            openProfileFile(item);
        })
    );
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

        // Always create status bars (but they'll be hidden if no conanfile)
        const hostProfileStatusBarItem = createProfileStatusBarItem('host');
        context.subscriptions.push(hostProfileStatusBarItem);
        const buildProfileStatusBarItem = createProfileStatusBarItem('build');
        context.subscriptions.push(buildProfileStatusBarItem);

        // Initialize centralized store
        const conanStore = new ConanStore();
        conanStore.workspaceRoot = workspaceRoot;

        // Load saved configuration into store
        conanStore.initializeFromConfig();

        // Initialize server manager and API client
        const serverManager = new ConanServerManager(conanStore, backendUrl);
        const apiClient = new ConanApiClient(serverManager);

        // Listen for profile changes to update status bars and refresh packages
        conanStore.onActiveProfileChange((profileType) => {
            if (!conanStore || !apiClient) {
                return;
            }

            if (profileType === 'host') {
                updateProfileStatusBar(hostProfileStatusBarItem, 'host', conanStore.activeHostProfile);
                updateHostProfileWatcher(conanStore, apiClient);
            } else if (profileType === 'build') {
                updateProfileStatusBar(buildProfileStatusBarItem, 'build', conanStore.activeBuildProfile);
                updateBuildProfileWatcher(conanStore, apiClient);
            }
            refreshPackages(conanStore, apiClient);
        });

        // Initial status bar update and file watchers
        updateProfileStatusBar(hostProfileStatusBarItem, 'host', conanStore.activeHostProfile);
        updateHostProfileWatcher(conanStore, apiClient);
        updateProfileStatusBar(buildProfileStatusBarItem, 'build', conanStore.activeBuildProfile);
        updateBuildProfileWatcher(conanStore, apiClient);

        // Initialize tree data providers with server support
        const packageProvider = new ConanPackageProvider(conanStore);
        const profileProvider = new ConanProfileProvider(conanStore);
        const remoteProvider = new ConanRemoteProvider(conanStore);

        // Register tree data providers
        vscode.window.registerTreeDataProvider('conan.packages', packageProvider);
        vscode.window.registerTreeDataProvider('conan.profiles', profileProvider);
        vscode.window.registerTreeDataProvider('conan.remotes', remoteProvider);

        const remoteStatusBarItem = createRemoteStatusBarItem();
        context.subscriptions.push(remoteStatusBarItem);

        // Listen for remote changes to update status bar
        conanStore.onActiveRemoteChange((remote) => {
            updateRemoteStatusBar(remoteStatusBarItem, remote);
        });
        // Initial status bar update
        updateRemoteStatusBar(remoteStatusBarItem, conanStore.activeRemote);

        const hostProfile = conanStore.activeHostProfile ? conanStore.activeHostProfile.name : 'None';
        const buildProfile = conanStore.activeBuildProfile ? conanStore.activeBuildProfile.name : 'None';
        const remote = conanStore.activeRemote === 'all' ? 'All ' : conanStore.activeRemote.name;
        logger.info(`Final profiles after loading: Host=${hostProfile}, Build=${buildProfile}, Remote=${remote}`);

        registerCommands(context, conanStore, apiClient, serverManager);

        // Create conanfile watcher regardless of current state
        // This enables detection of conanfile creation/deletion
        const conanfileWatcher = createConanfileWatcher(context, workspaceRoot, serverManager, conanStore, apiClient, {
            hostProfile: hostProfileStatusBarItem,
            buildProfile: buildProfileStatusBarItem,
            remote: remoteStatusBarItem
        });
        context.subscriptions.push(conanfileWatcher);

        // Also watch for configuration changes that might affect conanfile preference
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('conan.preferredConanfileFormat')) {
                    logger.info('Conanfile preference configuration changed');
                    handleConanfileChanged(workspaceRoot, conanStore, apiClient);
                }

                // Watch for local profiles path changes
                if (event.affectsConfiguration('conan.localProfilesPath')) {
                    logger.info('Local profiles path configuration changed');
                    if (profileFolderWatcherService) {
                        // Get the new local profiles path and update the watcher
                        const config = vscode.workspace.getConfiguration('conan');
                        const localProfilesPath = config.get<string>('localProfilesPath', '.conan2/profiles');
                        const absoluteLocalProfilesPath = localProfilesPath.startsWith('.') ?
                            `${workspaceRoot}/${localProfilesPath}` : localProfilesPath;

                        profileFolderWatcherService.setLocalProfileFolder(absoluteLocalProfilesPath);
                        // Refresh profiles to pick up any new profiles in the new location
                        refreshProfiles(conanStore, apiClient);
                    }
                }
            })
        );

        // Start extension if conanfile already exists
        const conanfileInfo = detectConanfiles(workspaceRoot);
        if (conanfileInfo.hasAnyConanfile) {
            start(context, workspaceRoot, serverManager, conanStore, apiClient, {
                hostProfile: hostProfileStatusBarItem,
                buildProfile: buildProfileStatusBarItem,
                remote: remoteStatusBarItem
            });
        }

        // Show welcome message
        vscode.window.showInformationMessage('Conan Package Manager extension activated! 🎉');
    }
}

export function deactivate() {
    logger?.info('🔌 Conan Package Manager extension deactivated');
}