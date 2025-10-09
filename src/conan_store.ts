import * as vscode from 'vscode';
import { getLogger } from './logger';
import { ServerState } from './conan_server_manager';

// Valid item types for package tree items only
export type PackageItemType =
    | 'package-available'
    | 'package-downloadable'
    | 'package-uploadable'
    | 'package-buildable'
    | 'package-incompatible'
    | 'package-unknown'
    | 'package-installing'
    | 'package-uploading'
    | 'package-producer';


export type PackageLocalRecipeStatus = 'none' | 'cache' | 'consumer';
export type PackageLocalBinaryStatus = 'none' | 'cache';

export type PackageRemoteRecipeStatus = 'none' | 'available';
export type PackageRemoteBinaryStatus = 'none' | 'available';

export interface PackageLocalStatus {
    recipe_status: PackageLocalRecipeStatus;
    binary_status: PackageLocalBinaryStatus;
}

export interface PackageRemoteStatus {
    remote_name: string;
    recipe_status: PackageRemoteRecipeStatus;
    binary_status: PackageRemoteBinaryStatus;
}

// TypeScript interfaces for API responses
export interface PackageAvailability {
    is_incompatible: boolean;
    incompatible_reason?: string;
    local_status: PackageLocalStatus;
    remotes_status: PackageRemoteStatus[];
}

export interface PackageInfo {
    name: string;
    version: string;
    ref: string;
    id: string;
    availability: PackageAvailability;
    dependencies?: PackageInfo[];
}

export type ProfileType = 'host' | 'build';

export interface Profile {
    name: string;
    path: string;
    isLocal: boolean; // Whether this is a local profile (workspace-specific) vs global
}

function isValidProfile(value: any): value is Profile {
    return value !== null &&
        typeof value === 'object' &&
        typeof value.name === 'string' &&
        typeof value.path === 'string' &&
        typeof value.isLocal === 'boolean';
}

export interface Remote {
    name: string;
    url: string;
    requires_auth: boolean;
}

export type AllRemotes = 'all';

function isValidRemote(value: any): value is Remote {
    return value !== null &&
           typeof value === 'object' &&
           typeof value.name === 'string' &&
           typeof value.url === 'string';
}

function isValidActiveRemote(value: any): value is Remote | AllRemotes {
    return value === 'all' || isValidRemote(value);
}

// Task management types
export enum TaskType {
    INSTALL_PACKAGE = 'installPackage',
    UPLOAD_PACKAGE = 'uploadPackage',
    BUILD_PACKAGE = 'buildPackage',
    CREATE_PACKAGE = 'createPackage',
    TEST_PACKAGE = 'testPackage',
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

interface State {
    packages: PackageInfo[] | undefined;
    profiles: Profile[] | undefined;
    remotes: Remote[] | undefined;
    serverState: ServerState;
    activeHostProfile: Profile | null;
    activeBuildProfile: Profile | null;
    activeRemote: Remote | AllRemotes;
    workspaceRoot: string;
    currentTask: RunningTask | null;
}

// Individual reducers for each piece of state
function packagesReducer(state: PackageInfo[] | undefined, action: StoreAction): PackageInfo[] | undefined {
    if (action.type === 'SET_PACKAGES') {
        return action.payload;
    }
    return state;
}

function profilesReducer(state: Profile[] | undefined, action: StoreAction): Profile[] | undefined {
    if (action.type === 'SET_PROFILES') {
        return action.payload;
    }
    return state;
}

function remotesReducer(state: Remote[] | undefined, action: StoreAction): Remote[] | undefined {
    if (action.type === 'SET_REMOTES') {
        return action.payload;
    }
    return state;
}

function serverStateReducer(state: ServerState, action: StoreAction): ServerState {
    if (action.type === 'SET_SERVER_STATE') {
        return action.payload;
    }
    return state;
}

function activeHostProfileReducer(state: Profile | null, action: StoreAction): Profile | null {
    if (action.type === 'SET_PROFILE' && action.payload.profileType === 'host') {
        return action.payload.profile;
    }
    return state;
}

function activeBuildProfileReducer(state: Profile | null, action: StoreAction): Profile | null {
    if (action.type === 'SET_PROFILE' && action.payload.profileType === 'build') {
        return action.payload.profile;
    }
    return state;
}

function activeRemoteReducer(state: Remote | AllRemotes, action: StoreAction): Remote | AllRemotes {
    if (action.type === 'SET_REMOTE') {
        return action.payload;
    }
    return state;
}

function workspaceRootReducer(state: string, action: StoreAction): string {
    if (action.type === 'SET_WORKSPACE_ROOT') {
        return action.payload;
    }
    return state;
}

function currentTaskReducer(state: RunningTask | null, action: StoreAction): RunningTask | null {
    if (action.type === 'SET_CURRENT_TASK') {
        return action.payload;
    }
    return state;
}

function rootReducer(state: State, action: StoreAction): State {
    return {
        packages: packagesReducer(state.packages, action),
        profiles: profilesReducer(state.profiles, action),
        remotes: remotesReducer(state.remotes, action),
        serverState: serverStateReducer(state.serverState, action),
        activeHostProfile: activeHostProfileReducer(state.activeHostProfile, action),
        activeBuildProfile: activeBuildProfileReducer(state.activeBuildProfile, action),
        activeRemote: activeRemoteReducer(state.activeRemote, action),
        workspaceRoot: workspaceRootReducer(state.workspaceRoot, action),
        currentTask: currentTaskReducer(state.currentTask, action),
    };
}

// Centralized store for managing all Conan data and state
export class ConanStore implements vscode.Disposable {

    private state: State = {
        packages: undefined,
        profiles: undefined,
        remotes: undefined,
        serverState: 'stopped',
        activeHostProfile: null,
        activeBuildProfile: null,
        activeRemote: 'all',
        workspaceRoot: '',
        currentTask: null
    };
    private _onStateChange = new vscode.EventEmitter<State>();
    readonly onStateChange = this._onStateChange.event;

    dispatch(action: StoreAction): void {
        this.state = rootReducer(this.state, action);
        this._onStateChange.fire(this.state);
    }

    // Generic slice subscription
    subscribe<T>(selector: (s: State) => T, listener: (value: T) => void): vscode.Disposable {
        let last = selector(this.state);
        return this.onStateChange(state => {
            const next = selector(state);
            if (next !== last) {
                last = next;
                listener(next);
            }
        });
    }

    constructor() {
    }

    // Server state management
    getServerState(): ServerState {
        return this.state.serverState;
    }

    setServerState(state: ServerState): void {
        if (this.state.serverState !== state) {
            this.dispatch({ type: 'SET_SERVER_STATE', payload: state });
            this.dispatch({ type: 'SET_PACKAGES', payload: undefined });
        }
    }

    // Profile management
    get activeHostProfile(): Profile | null {
        return this.state.activeHostProfile;
    }

    set activeHostProfile(profile: Profile | null) {
        this.dispatch({ type: 'SET_PROFILE', payload: { profileType: 'host', profile } });
        this.dispatch({ type: 'SET_PACKAGES', payload: undefined });
    }

    get activeBuildProfile(): Profile | null {
        return this.state.activeBuildProfile;
    }

    set activeBuildProfile(profile: Profile | null) {
        this.dispatch({ type: 'SET_PROFILE', payload: { profileType: 'build', profile } });
        this.dispatch({ type: 'SET_PACKAGES', payload: undefined });
    }

    // Remote management
    get activeRemote(): Remote | AllRemotes {
        return this.state.activeRemote;
    }

    set activeRemote(remote: Remote | AllRemotes) {
        this.dispatch({ type: 'SET_REMOTE', payload: remote });
        this.dispatch({ type: 'SET_PACKAGES', payload: undefined });
    }

    // Workspace root management
    get workspaceRoot(): string {
        return this.state.workspaceRoot;
    }

    set workspaceRoot(root: string) {
        this.dispatch({ type: 'SET_WORKSPACE_ROOT', payload: root });
        this.dispatch({ type: 'SET_PACKAGES', payload: undefined });
    }

    // Initialize from saved configuration
    initializeFromConfig() {
        const config = vscode.workspace.getConfiguration('conan');

        const savedHostProfile = config.get<Profile | null>('activeHostProfile');
        if (savedHostProfile !== undefined && savedHostProfile !== null && isValidProfile(savedHostProfile)) {
            this.dispatch({ type: 'SET_PROFILE', payload: { profileType: 'host', profile: savedHostProfile } });
        }

        const savedBuildProfile = config.get<Profile | null>('activeBuildProfile');
        if (savedBuildProfile !== undefined && savedBuildProfile !== null && isValidProfile(savedBuildProfile)) {
            this.dispatch({ type: 'SET_PROFILE', payload: { profileType: 'build', profile: savedBuildProfile } });
        }

        const savedRemote = config.get<Remote | AllRemotes>('activeRemote');
        if (savedRemote !== undefined && savedRemote !== null && isValidActiveRemote(savedRemote)) {
            this.dispatch({ type: 'SET_REMOTE', payload: savedRemote });
        }
    }

    // Save current configuration
    async saveConfiguration(): Promise<void> {
        const config = vscode.workspace.getConfiguration('conan');
        await config.update('activeHostProfile', this.state.activeHostProfile, vscode.ConfigurationTarget.Workspace);
        await config.update('activeBuildProfile', this.state.activeBuildProfile, vscode.ConfigurationTarget.Workspace);
        await config.update('activeRemote', this.state.activeRemote, vscode.ConfigurationTarget.Workspace);
    }

    // Get packages (cached)
    getPackages(): PackageInfo[] | undefined {
        return this.state.packages;
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
        return this.state.packages?.find(pkg => pkg.ref === packageRef);
    }

    // Check if cache is valid
    isCacheValid(): boolean {
        return this.state.packages !== null && this.state.serverState === 'running';
    }

    // Get cache statistics
    getCacheStats(): { packageCount: number; isValid: boolean; lastRefresh: string } {
        return {
            packageCount: this.state.packages?.length || 0,
            isValid: this.state.packages !== null,
            lastRefresh: `Workspace: ${this.state.workspaceRoot}, Remote: ${this.state.activeRemote}, Host: ${this.state.activeHostProfile}, Build: ${this.state.activeBuildProfile}`
        };
    }

    // Profile management
    getProfiles(): Profile[] | undefined {
        return this.state.profiles;
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
        return this.state.remotes;
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
        return this.state.currentTask;
    }

    isTaskRunning(): boolean {
        return this.state.currentTask !== null;
    }

    // Dispose method to clean up EventEmitters - implements vscode.Disposable
    dispose(): void {
    }

    private get logger() {
        return getLogger();
    }
}