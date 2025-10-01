import * as vscode from 'vscode';
import { Profile, ProfileType } from '../conan_store';
import { getLogger } from '../logger';

/**
 * Event data for active profile file changes
 */
export interface ActiveProfileChangeEvent {
    profileType: ProfileType;
    type: 'changed' | 'deleted';
    filePath: string;
}

/**
 * Service to manage file system watchers for active profile files
 */
export class ActiveProfileWatcherService implements vscode.Disposable {
    private hostProfileWatcher: vscode.FileSystemWatcher | undefined;
    private buildProfileWatcher: vscode.FileSystemWatcher | undefined;
    
    // Replace callback array with EventEmitter
    private readonly _onActiveProfileChange = new vscode.EventEmitter<ActiveProfileChangeEvent>();
    readonly onActiveProfileChange = this._onActiveProfileChange.event;

    constructor() {
    }

    /**
     * Notify all callbacks of active profile file change
     */
    private notifyActiveProfileChange(event: ActiveProfileChangeEvent): void {
        this._onActiveProfileChange.fire(event);
    }

    /**
     * Update the host profile watcher
     */
    setHostProfile(profile: Profile | null): void {
        // Dispose existing watcher
        if (this.hostProfileWatcher) {
            this.hostProfileWatcher.dispose();
        }
        this.hostProfileWatcher = this.createProfileWatcher('host', profile);
    }

    /**
     * Update the build profile watcher
     */
    setBuildProfile(profile: Profile | null): void {
        // Dispose existing watcher
        if (this.buildProfileWatcher) {
            this.buildProfileWatcher.dispose();
        }
        this.buildProfileWatcher = this.createProfileWatcher('build', profile);
    }

    /**
     * Create a file system watcher for a specific profile
     */
    private createProfileWatcher(profileType: ProfileType, profile: Profile | null): vscode.FileSystemWatcher | undefined {
        if (!profile || !profile.path) {
            return undefined;
        }

        try {
            const profileUri = vscode.Uri.file(profile.path);
            const watcher = vscode.workspace.createFileSystemWatcher(profileUri.fsPath);

            watcher.onDidChange(() => {
                this.logger.info(`${profileType} profile file changed: ${profile.path}`);
                this.notifyActiveProfileChange({
                    profileType,
                    type: 'changed',
                    filePath: profile.path
                });
            });

            watcher.onDidDelete(() => {
                this.logger.warn(`${profileType} profile file deleted: ${profile.path}`);
                this.notifyActiveProfileChange({
                    profileType,
                    type: 'deleted',
                    filePath: profile.path
                });
            });

            this.logger.info(`${profileType} profile watcher created for: ${profile.path}`);
            return watcher;
        } catch (error) {
            this.logger.warn(`Failed to create ${profileType} profile watcher: ${error}`);
            return undefined;
        }
    }

    /**
     * Dispose all watchers - implements vscode.Disposable
     */
    dispose(): void {
        if (this.hostProfileWatcher) {
            this.hostProfileWatcher.dispose();
            this.hostProfileWatcher = undefined;
        }
        if (this.buildProfileWatcher) {
            this.buildProfileWatcher.dispose();
            this.buildProfileWatcher = undefined;
        }
        // Dispose EventEmitter
        this._onActiveProfileChange.dispose();
    }

    private get logger() {
        return getLogger();
    }
}
