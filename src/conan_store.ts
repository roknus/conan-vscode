import * as vscode from 'vscode';
import { getLogger } from './logger';

// Server state enumeration
export type ServerState = 'starting' | 'running' | 'stopped' | 'error';

export type PackageStatus = 'none' | 'recipe' | 'recipe+binary';

// Valid item types for package tree items only
export type PackageItemType =
    | 'package-available'
    | 'package-downloadable'
    | 'package-uploadable'
    | 'package-buildable'
    | 'package-incompatible'
    | 'package-unknown'
    | 'package-installing'
    | 'package-uploading';

// TypeScript interfaces for API responses
export interface PackageAvailability {
    is_incompatible: boolean;
    incompatible_reason?: string;
    local_status: PackageStatus;
    remote_status: PackageStatus;
}

export interface PackageInfo {
    name: string;
    ref: string;
    availability: PackageAvailability;
}

export type ProfileType = 'host' | 'build';

export interface Profile {
    name: string;
    path: string;
    isLocal: boolean; // Whether this is a local profile (workspace-specific) vs global
}

export interface Remote {
    name: string;
    url: string;
}

export type AllRemotes = 'all';

// Task management types
export enum TaskType {
    INSTALL_PACKAGE = 'installPackage',
    UPLOAD_PACKAGE = 'uploadPackage',
}

export interface RunningTask {
    type: TaskType;
    description: string;
    packageRef?: string; // For package-specific tasks
}

// Action types for the store reducer
interface StoreAction {
    type: 'SET_PACKAGES' | 'SET_SERVER_STATE' | 'SET_PROFILE' | 'SET_REMOTE' | 'SET_WORKSPACE_ROOT' | 'SET_PROFILES' | 'SET_REMOTES' | 'SET_CURRENT_TASK';
    payload?: any;
}

// Centralized store for managing all Conan data and state
export class ConanStore {
    private cachedPackages: PackageInfo[] | undefined = undefined;
    private cachedProfiles: Profile[] | undefined = undefined;
    private cachedRemotes: Remote[] | undefined = undefined;
    private stateChangeCallbacks: (() => void)[] = [];
    private activeProfileChangeCallbacks: ((profileType: ProfileType) => void)[] = [];
    private serverStateChangeCallbacks: ((state: ServerState) => void)[] = [];

    // Task management
    private currentTask: RunningTask | null = null;
    private taskStateChangeCallbacks: ((task: RunningTask | null) => void)[] = [];

    // Server state
    private _serverState: ServerState = 'stopped';

    // Active state
    private _activeHostProfile: Profile | null = null;
    private _activeBuildProfile: Profile | null = null;
    private _activeRemote: Remote | AllRemotes = 'all';
    private _workspaceRoot: string = '';

    constructor() { }

    // Reducer function for state updates
    dispatch(action: StoreAction): void {
        switch (action.type) {
            case 'SET_PACKAGES':
                this.cachedPackages = action.payload;
                this.notifyDataChange();
                break;

            case 'SET_SERVER_STATE':
                if (this._serverState !== action.payload) {
                    this._serverState = action.payload;
                    this.dispatch({ type: 'SET_PACKAGES', payload: undefined });
                    this.notifyServerStateChange(action.payload);
                }
                break;

            case 'SET_PROFILE':
                const { profileType, profile } = action.payload;
                if (profileType === 'host' && this._activeHostProfile !== profile) {
                    this._activeHostProfile = profile;
                    this.dispatch({ type: 'SET_PACKAGES', payload: undefined });
                    this.notifyActiveProfileChange('host');
                } else if (profileType === 'build' && this._activeBuildProfile !== profile) {
                    this._activeBuildProfile = profile;
                    this.dispatch({ type: 'SET_PACKAGES', payload: undefined });
                    this.notifyActiveProfileChange('build');
                }
                break;

            case 'SET_REMOTE':
                if (this._activeRemote !== action.payload) {
                    this._activeRemote = action.payload;
                    this.dispatch({ type: 'SET_PACKAGES', payload: undefined });
                    this.notifyDataChange();
                }
                break;

            case 'SET_WORKSPACE_ROOT':
                if (this._workspaceRoot !== action.payload) {
                    this._workspaceRoot = action.payload;
                    this.dispatch({ type: 'SET_PACKAGES', payload: undefined });
                    this.notifyDataChange();
                }
                break;

            case 'SET_PROFILES':
                this.cachedProfiles = action.payload;
                this.notifyDataChange();
                break;

            case 'SET_REMOTES':
                this.cachedRemotes = action.payload;
                this.notifyDataChange();
                break;

            case 'SET_CURRENT_TASK':
                this.currentTask = action.payload;
                this.logger.info(action.payload ? `Task started: ${action.payload.description}` : 'Task completed');
                this.notifyTaskStateChange(action.payload);
                break;

            default:
                this.logger.warn(`Unknown store action type: ${(action as any).type}`);
        }
    }

    // Server state management
    getServerState(): ServerState {
        return this._serverState;
    }

    setServerState(state: ServerState): void {
        this.dispatch({ type: 'SET_SERVER_STATE', payload: state });
    }

    // Register callback for server state changes
    onServerStateChange(callback: (state: ServerState) => void): void {
        this.serverStateChangeCallbacks.push(callback);
    }

    // Remove server state callback
    removeServerStateChangeCallback(callback: (state: ServerState) => void): void {
        const index = this.serverStateChangeCallbacks.indexOf(callback);
        if (index > -1) {
            this.serverStateChangeCallbacks.splice(index, 1);
        }
    }

    // Notify all callbacks of server state change
    private notifyServerStateChange(state: ServerState): void {
        this.serverStateChangeCallbacks.forEach(callback => {
            try {
                callback(state);
            } catch (error) {
                this.logger.error('Error in server state change callback:', error);
            }
        });
    }

    // Profile management
    get activeHostProfile(): Profile | null {
        return this._activeHostProfile;
    }

    set activeHostProfile(profile: Profile | null) {
        this.dispatch({ type: 'SET_PROFILE', payload: { profileType: 'host', profile } });
    }

    get activeBuildProfile(): Profile | null {
        return this._activeBuildProfile;
    }

    set activeBuildProfile(profile: Profile | null) {
        this.dispatch({ type: 'SET_PROFILE', payload: { profileType: 'build', profile } });
    }

    // Remote management
    get activeRemote(): Remote | AllRemotes {
        return this._activeRemote;
    }

    set activeRemote(remote: Remote | AllRemotes) {
        this.dispatch({ type: 'SET_REMOTE', payload: remote });
    }

    // Workspace root management
    get workspaceRoot(): string {
        return this._workspaceRoot;
    }

    set workspaceRoot(root: string) {
        this.dispatch({ type: 'SET_WORKSPACE_ROOT', payload: root });
    }

    // Initialize from saved configuration
    initializeFromConfig() {
        const config = vscode.workspace.getConfiguration('conan');

        const savedHostProfile = config.get<Profile | null>('activeHostProfile');
        if (savedHostProfile) {
            this._activeHostProfile = savedHostProfile;
        }

        const savedBuildProfile = config.get<Profile | null>('activeBuildProfile');
        if (savedBuildProfile) {
            this._activeBuildProfile = savedBuildProfile;
        }

        const savedRemote = config.get<Remote | AllRemotes>('activeRemote');
        if (savedRemote) {
            this._activeRemote = savedRemote; // URL will be resolved later
        }
    }

    // Save current configuration
    async saveConfiguration(): Promise<void> {
        const config = vscode.workspace.getConfiguration('conan');
        await config.update('activeHostProfile', this._activeHostProfile, vscode.ConfigurationTarget.Workspace);
        await config.update('activeBuildProfile', this._activeBuildProfile, vscode.ConfigurationTarget.Workspace);
        await config.update('activeRemote', this._activeRemote, vscode.ConfigurationTarget.Workspace);
    }

    // Register callback for data changes
    onDataChange(callback: () => void): void {
        this.stateChangeCallbacks.push(callback);
    }

    // Remove callback
    removeDataChangeCallback(callback: () => void): void {
        const index = this.stateChangeCallbacks.indexOf(callback);
        if (index > -1) {
            this.stateChangeCallbacks.splice(index, 1);
        }
    }

    // Notify all callbacks of data change
    private notifyDataChange(): void {
        this.stateChangeCallbacks.forEach(callback => {
            try {
                callback();
            } catch (error) {
                this.logger.error('Error in data change callback:', error);
            }
        });
    }

    onActiveProfileChange(callback: (profileType: ProfileType) => void): void {
        this.activeProfileChangeCallbacks.push(callback);
    }
    
    removeActiveProfileChangeCallback(callback: (profileType: ProfileType) => void): void {
        const index = this.activeProfileChangeCallbacks.indexOf(callback);
        if (index > -1) {
            this.activeProfileChangeCallbacks.splice(index, 1);
        }
    }

    private notifyActiveProfileChange(profileType: ProfileType): void {
        this.activeProfileChangeCallbacks.forEach(callback => {
            try {
                callback(profileType);
            } catch (error) {
                this.logger.error('Error in profile change callback:', error);
            }
        });
    }

    // Get packages (cached)
    getPackages(): PackageInfo[] | undefined {
        return this.cachedPackages;
    }

    // Set packages through reducer
    setPackages(packages: PackageInfo[]): void {
        this.dispatch({ type: 'SET_PACKAGES', payload: packages });
        this.logger.debug(`Updated package cache: ${packages.length} packages`);
    }

    // Clear package cache
    clearPackageCache(): void {
        this.dispatch({ type: 'SET_PACKAGES', payload: undefined });
    }

    // Get package by reference
    getPackageByRef(packageRef: string): PackageInfo | undefined {
        return this.cachedPackages?.find(pkg => pkg.ref === packageRef);
    }

    // Check if cache is valid
    isCacheValid(): boolean {
        return this.cachedPackages !== null && this._serverState === 'running';
    }

    // Get cache statistics
    getCacheStats(): { packageCount: number; isValid: boolean; lastRefresh: string } {
        return {
            packageCount: this.cachedPackages?.length || 0,
            isValid: this.cachedPackages !== null,
            lastRefresh: `Workspace: ${this._workspaceRoot}, Remote: ${this._activeRemote}, Host: ${this._activeHostProfile}, Build: ${this._activeBuildProfile}`
        };
    }

    // Profile management
    getProfiles(): Profile[] | undefined {
        return this.cachedProfiles;
    }

    setProfiles(profiles: Profile[]): void {
        this.dispatch({ type: 'SET_PROFILES', payload: profiles });
    }

    // Clear profiles cache
    clearProfileCache(): void {
        this.dispatch({ type: 'SET_PROFILES', payload: undefined });
    }

    // Remote management  
    getRemotes(): Remote[] | undefined {
        return this.cachedRemotes;
    }

    setRemotes(remotes: Remote[]): void {
        this.dispatch({ type: 'SET_REMOTES', payload: remotes });
    }

    // Clear remotes cache
    clearRemoteCache(): void {
        this.dispatch({ type: 'SET_REMOTES', payload: undefined });
    }

    // Task management methods
    setCurrentTask(task: RunningTask | null): void {
        this.dispatch({ type: 'SET_CURRENT_TASK', payload: task });
    }

    getCurrentTask(): RunningTask | null {
        return this.currentTask;
    }

    isTaskRunning(): boolean {
        return this.currentTask !== null;
    }

    getPackageLoadingType(packageRef: string): PackageItemType | null {
        if (!this.currentTask || this.currentTask.packageRef !== packageRef) {
            return null;
        }

        switch (this.currentTask.type) {
            case TaskType.INSTALL_PACKAGE:
                return 'package-installing';
            case TaskType.UPLOAD_PACKAGE:
                return 'package-uploading';
            default:
                return 'package-installing'; // Default fallback
        }
    }

    onTaskStateChange(callback: (task: RunningTask | null) => void): void {
        this.taskStateChangeCallbacks.push(callback);
    }

    removeTaskStateChangeCallback(callback: (task: RunningTask | null) => void): void {
        const index = this.taskStateChangeCallbacks.indexOf(callback);
        if (index > -1) {
            this.taskStateChangeCallbacks.splice(index, 1);
        }
    }

    private notifyTaskStateChange(task: RunningTask | null): void {
        this.taskStateChangeCallbacks.forEach(callback => {
            try {
                callback(task);
            } catch (error) {
                this.logger.error('Error in task state change callback:', error);
            }
        });
    }

    private get logger() {
        return getLogger();
    }
}