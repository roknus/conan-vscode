import * as vscode from 'vscode';
import { ConanStore, Profile, ProfileType, TaskType } from './conan_store';
import { ConanApiClient } from './conan_api_client';
import { getLogger } from './logger';
import { ConanPackageItem } from './tree_data_providers/conan_package_item';

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

export async function selectProfile(conanStore: ConanStore, profileType: ProfileType): Promise<void> {
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

export async function selectRemote(conanStore: ConanStore): Promise<void> {
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

export async function refreshPackages(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {

    conanStore.clearPackageCache();

    if (conanStore.activeHostProfile === null) {
        vscode.window.showErrorMessage('No active host profile selected. Please select a host profile before refreshing packages.');
        return;
    }

    if (conanStore.activeBuildProfile === null) {
        vscode.window.showErrorMessage('No active build profile selected. Please select a build profile before refreshing packages.');
        return;
    }

    try {
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

export async function refreshProfiles(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {
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

export async function refreshRemotes(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {
    try {
        conanStore.clearRemoteCache();
        const remotes = await apiClient.getRemotes();
        conanStore.setRemotes(remotes);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh remotes: ${error}`);
    }
}

export async function installAllPackages(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {
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

    getLogger().info('🔧 Installing all packages...');
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
        getLogger().info(`✅ Package installation started successfully with profiles: host=${conanStore.activeHostProfile}, build=${conanStore.activeBuildProfile}`);
        vscode.window.showInformationMessage(`Package installation started via API server with profiles: host=${conanStore.activeHostProfile}, build=${conanStore.activeBuildProfile}`);

    } catch (error) {
        getLogger().error(`❌ Package installation failed:`, error);
        vscode.window.showErrorMessage(`Package installation failed: ${error}`);
    } finally {
        conanStore.setCurrentTask(null);
    }

    // Clear package status after installation
    refreshPackages(conanStore, apiClient);
}

export async function installSinglePackage(conanStore: ConanStore, apiClient: ConanApiClient, item?: ConanPackageItem): Promise<void> {
    if (!item || !item.packageInfo) {
        getLogger().warn('⚠️ No package selected for installation');
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
    getLogger().info(`📦 Installing package: ${packageRef}`);

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
            conanStore.workspaceRoot,
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

export async function createProfile(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {
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

export async function addRemote(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {
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

export async function uploadLocalPackage(conanStore: ConanStore, apiClient: ConanApiClient, item?: ConanPackageItem): Promise<void> {
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
                    conanStore.workspaceRoot,
                    item.packageInfo.ref,
                    item.packageInfo.id,
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