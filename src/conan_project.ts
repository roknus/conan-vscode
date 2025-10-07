import * as vscode from 'vscode';
import { ConanServerManager } from './conan_server_manager';
import { ConanStore } from './conan_store';
import { ConanApiClient } from './conan_api_client';
import { ConanPackageProvider } from './tree_data_providers/conan_package_provider';
import { ConanProfileProvider } from './tree_data_providers/conan_profile_provider';
import { ConanRemoteProvider } from './tree_data_providers/conan_remote_provider';
import { ConanPackageItem } from './tree_data_providers/conan_package_item';

import {
    installAllPackages,
    installSinglePackage,
    createProfile,
    uploadLocalPackage,
    refreshPackages,
    refreshProfiles,
    refreshRemotes,
    selectProfile
} from './commands/commands';
import { ProfileStatusBar } from './conan_profile_status_bar';
import { getLogger } from './logger';
import { RemoteStatusBar } from './conan_remote_status_bar';
import { ProfileFolderChangeEvent, ProfileFolderWatcher } from './services/profile_folder_watcher';
import { addRemote } from './commands/remotes/add_remote';
import { ConanRemoteItem } from './tree_data_providers/conan_remote_item';
import { removeRemote } from './commands/remotes/remove_remote';
import { selectRemote } from './commands/remotes/select_remote';
import { loginRemote } from './commands/remotes/login_remote';
/**
 * Register extension commands
 */
function registerCommands(conanStore: ConanStore, apiClient: ConanApiClient): vscode.Disposable {

    // Register commands
    return vscode.Disposable.from(
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

        vscode.commands.registerCommand('conan.loginRemote', (item?: ConanRemoteItem) => {
            if (item && apiClient) {
                loginRemote(item.remote.name, apiClient);
            }
        }),

        vscode.commands.registerCommand('conan.removeRemote', (item?: ConanRemoteItem) => {
            if (item && apiClient) {
                removeRemote(item.remote.name, apiClient);
            }
        }),

        vscode.commands.registerCommand('conan.uploadLocalPackage', (item?: ConanPackageItem) => {
            if (conanStore && apiClient) {
                uploadLocalPackage(conanStore, apiClient, item);
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
    );
}


export class ConanProject implements vscode.Disposable {

    public conanStore: ConanStore;
    public api: ConanApiClient;
    private disposables: vscode.Disposable[] = [];

    hostProfileStatusBar: ProfileStatusBar = new ProfileStatusBar('host');
    buildProfileStatusBar: ProfileStatusBar = new ProfileStatusBar('build');
    remoteStatusBar: RemoteStatusBar = new RemoteStatusBar();

    globalProfileFolderWatcherService: ProfileFolderWatcher = new ProfileFolderWatcher();
    localProfileFolderWatcherService: ProfileFolderWatcher = new ProfileFolderWatcher();


    constructor(workspaceRoot: string, private serverManager: ConanServerManager) {
        this.conanStore = new ConanStore();
        this.conanStore.workspaceRoot = workspaceRoot;
        this.disposables.push(this.conanStore);
        this.api = new ConanApiClient(this.serverManager);


        this.disposables.push(this.serverManager.onStateChange((newState) => {
            this.conanStore.setServerState(newState);
        }));

        this.initializeProviders();

        this.disposables.push(registerCommands(this.conanStore, this.api));

        this.initializeStatusBars();
        this.initializeProfileFolderWatchers();
    }

    dispose() {
        // Dispose resources if any
        this.disposables.forEach(disposable => disposable.dispose());
    }

    private initializeProviders() {

        // Initialize tree data providers with server support
        const packageProvider = new ConanPackageProvider(this.conanStore);
        const profileProvider = new ConanProfileProvider(this.conanStore);
        const remoteProvider = new ConanRemoteProvider(this.conanStore);

        this.disposables.push(
            packageProvider,
            profileProvider,
            remoteProvider,
            // Register tree data providers
            vscode.window.registerTreeDataProvider('conan.packages', packageProvider),
            vscode.window.registerTreeDataProvider('conan.profiles', profileProvider),
            vscode.window.registerTreeDataProvider('conan.remotes', remoteProvider),
        );
    }

    private initializeStatusBars() {

        // Initialize Host Profile status bar item
        this.disposables.push(this.hostProfileStatusBar,

            this.hostProfileStatusBar.onProfileFileChange((event) => {
                if (event.type === 'changed') {
                    this.logger.info(`${event.profileType} profile file changed, refreshing packages`);
                    refreshPackages(this.conanStore, this.api);
                } else if (event.type === 'deleted') {
                    this.conanStore.activeHostProfile = null;
                    this.conanStore.saveConfiguration();
                    vscode.window.showWarningMessage(`Host profile file was deleted. Active host profile reset to None.`);
                }
            }),

            this.conanStore.subscribe(state => state.activeHostProfile, (profile) => {
                this.hostProfileStatusBar.setProfile(profile);
            })
        );

        // Initialize Build Profile status bar item
        this.disposables.push(this.buildProfileStatusBar,

            this.buildProfileStatusBar.onProfileFileChange((event) => {
                if (event.type === 'changed') {
                    this.logger.info(`${event.profileType} profile file changed, refreshing packages`);
                    refreshPackages(this.conanStore, this.api);
                } else if (event.type === 'deleted') {
                    this.conanStore.activeBuildProfile = null;
                    this.conanStore.saveConfiguration();
                    vscode.window.showWarningMessage(`Build profile file was deleted. Active build profile reset to None.`);
                }
            }),

            this.conanStore.subscribe(state => state.activeBuildProfile, (profile) => {
                this.buildProfileStatusBar.setProfile(profile);
            })
        );

        // Initialize Remote status bar item
        this.disposables.push(this.remoteStatusBar,

            this.conanStore.subscribe(state => state.activeRemote, (remote) => {
                this.remoteStatusBar.setRemote(remote);
            })
        );
    }

    private initializeProfileFolderWatchers() {


        // Initialize profile folder watcher service after server is connected
        this.disposables.push(this.globalProfileFolderWatcherService,

            // Register callback for profile folder changes
            this.globalProfileFolderWatcherService.onProfileFolderChange((event: ProfileFolderChangeEvent) => {
                refreshProfiles(this.conanStore, this.api);
            })
        );

        this.disposables.push(this.localProfileFolderWatcherService,

            // Register callback for profile folder changes
            this.localProfileFolderWatcherService.onProfileFolderChange((event: ProfileFolderChangeEvent) => {
                refreshProfiles(this.conanStore, this.api);
            }),

            // Also watch for configuration changes that might affect conanfile preference
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('conan.preferredConanfileFormat')) {
                    this.logger.info('Conanfile preference configuration changed');
                    //handleConanfileChanged(workspaceRoot, conanStore, apiClient);
                }

                // Watch for local profiles path changes
                if (event.affectsConfiguration('conan.localProfilesPath')) {
                    this.logger.info('Local profiles path configuration changed');
                    if (this.localProfileFolderWatcherService) {
                        // Get the new local profiles path and update the watcher
                        const config = vscode.workspace.getConfiguration('conan');
                        const localProfilesPath = config.get<string>('localProfilesPath', '.conan2/profiles');
                        const absoluteLocalProfilesPath = localProfilesPath.startsWith('.') ?
                            `${this.conanStore.workspaceRoot}/${localProfilesPath}` : localProfilesPath;

                        this.localProfileFolderWatcherService.activate(absoluteLocalProfilesPath);
                        // Refresh profiles to pick up any new profiles in the new location
                        refreshProfiles(this.conanStore, this.api);
                    }
                }
            })
        );

    }

    public async activate() {

        const globalProfilesPath = await this.api.getConanHome();
        this.globalProfileFolderWatcherService.activate(`${globalProfilesPath}/profiles`);

        // Get local profiles path from configuration
        const config = vscode.workspace.getConfiguration('conan');
        const localProfilesPath = config.get<string>('localProfilesPath', '.conan2/profiles');
        const absoluteLocalProfilesPath = localProfilesPath.startsWith('.') ?
            `${this.conanStore.workspaceRoot}/${localProfilesPath}` : localProfilesPath;

        // Initialize with both paths
        this.localProfileFolderWatcherService.activate(absoluteLocalProfilesPath);


        // Load saved configuration into store
        this.conanStore.initializeFromConfig();


        refreshProfiles(this.conanStore, this.api);
        refreshRemotes(this.conanStore, this.api);
        refreshPackages(this.conanStore, this.api);


        this.hostProfileStatusBar.activate();
        this.buildProfileStatusBar.activate();
        this.remoteStatusBar.activate();
    }

    public reload() {
        // Refresh packages since conanfile content or preference may have changed
        refreshPackages(this.conanStore, this.api);
    }

    public deactivate() {

        this.hostProfileStatusBar.deactivate();
        this.buildProfileStatusBar.deactivate();
        this.remoteStatusBar.deactivate();
    }

    private get logger() {
        return getLogger();
    }
}