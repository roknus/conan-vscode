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
    private changeCallbacks: ((event: ActiveProfileChangeEvent) => void)[] = [];

    constructor() {
    }

    /**
     * Register callback for active profile file changes
     */
    onActiveProfileChange(callback: (event: ActiveProfileChangeEvent) => void): void {
        this.changeCallbacks.push(callback);
    }

    /**
     * Remove callback for active profile file changes
     */
    removeActiveProfileChangeCallback(callback: (event: ActiveProfileChangeEvent) => void): void {
        const index = this.changeCallbacks.indexOf(callback);
        if (index > -1) {
            this.changeCallbacks.splice(index, 1);
        }
    }

    /**
     * Notify all callbacks of active profile file change
     */
    private notifyActiveProfileChange(event: ActiveProfileChangeEvent): void {
        this.changeCallbacks.forEach(callback => {
            try {
                callback(event);
            } catch (error) {
                this.logger.error('Error in active profile change callback:', error);
            }
        });
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
        // Clear callbacks
        this.changeCallbacks.length = 0;
    }

    private get logger() {
        return getLogger();
    }
}
