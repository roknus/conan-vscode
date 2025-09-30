import * as vscode from 'vscode';
import { getLogger } from '../logger';

/**
 * Event data for profile folder changes
 */
export interface ProfileFolderChangeEvent {
    type: 'created' | 'deleted';
    filePath: string;
}

/**
 * Service to manage file system watchers for profile directories
 */
export class ProfileFolderWatcherService implements vscode.Disposable {
    private globalProfileFolderWatcher: vscode.FileSystemWatcher | undefined;
    private localProfileFolderWatcher: vscode.FileSystemWatcher | undefined;
    private changeCallbacks: ((event: ProfileFolderChangeEvent) => void)[] = [];

    constructor() {
    }

    /**
     * Register callback for profile folder changes
     */
    onProfileFolderChange(callback: (event: ProfileFolderChangeEvent) => void): void {
        this.changeCallbacks.push(callback);
    }

    /**
     * Remove callback for profile folder changes
     */
    removeProfileFolderChangeCallback(callback: (event: ProfileFolderChangeEvent) => void): void {
        const index = this.changeCallbacks.indexOf(callback);
        if (index > -1) {
            this.changeCallbacks.splice(index, 1);
        }
    }

    /**
     * Notify all callbacks of profile folder change
     */
    private notifyProfileFolderChange(event: ProfileFolderChangeEvent): void {
        this.changeCallbacks.forEach(callback => {
            try {
                callback(event);
            } catch (error) {
                this.logger.error('Error in profile folder change callback:', error);
            }
        });
    }

    /**
     * Set the local profile folder path and create/update the watcher
     */
    setLocalProfileFolder(localProfilesPath: string): void {
        // Dispose existing watcher
        if (this.localProfileFolderWatcher) {
            this.localProfileFolderWatcher.dispose();
            this.localProfileFolderWatcher = undefined;
        }

        try {
            this.localProfileFolderWatcher = this.createProfileFolderWatcher(localProfilesPath);
        } catch (error) {
            this.logger.warn(`Failed to create local profile folder watcher: ${error}`);
        }
    }

    /**
     * Initialize both global and local profile folder watchers
     */
    async initialize(globalProfilesPath: string, localProfilesPath?: string) {
        // Dispose existing watcher
        if (this.globalProfileFolderWatcher) {
            this.globalProfileFolderWatcher.dispose();
            this.globalProfileFolderWatcher = undefined;
        }

        try {
            this.globalProfileFolderWatcher = this.createProfileFolderWatcher(globalProfilesPath);
        } catch (error) {
            this.logger.warn(`Failed to create global profile folder watcher: ${error}`);
        }

        if (localProfilesPath) {
            this.setLocalProfileFolder(localProfilesPath);
        }
    }

    /**
     * Create a generic file system watcher for profile folders
     */
    private createProfileFolderWatcher(path: string): vscode.FileSystemWatcher {
        const pattern = `${path}/**`;
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);

        watcher.onDidCreate(async (uri) => {
            if (await this.isProfileFile(uri.fsPath)) {
                this.logger.info(`Profile file created: ${uri.fsPath}`);
                this.notifyProfileFolderChange({
                    type: 'created',
                    filePath: uri.fsPath
                });
            }
        });

        watcher.onDidDelete(async (uri) => {
            // For deleted files, we can't stat them, so we'll use a simple heuristic
            // or assume the watcher only fires for files that existed before
            const fileName = uri.fsPath.split(/[/\\]/).pop() || '';
            const isFile = fileName.includes('.') && !fileName.endsWith('/') && !fileName.endsWith('\\');

            if (isFile) {
                this.logger.info(`Profile file deleted: ${uri.fsPath}`);
                this.notifyProfileFolderChange({
                    type: 'deleted',
                    filePath: uri.fsPath
                });
            }
        });

        this.logger.info(`Profile folder watcher created for: ${pattern}`);
        return watcher;
    }

    /**
     * Dispose all watchers - implements vscode.Disposable
     */
    dispose(): void {
        if (this.globalProfileFolderWatcher) {
            this.globalProfileFolderWatcher.dispose();
            this.globalProfileFolderWatcher = undefined;
        }
        if (this.localProfileFolderWatcher) {
            this.localProfileFolderWatcher.dispose();
            this.localProfileFolderWatcher = undefined;
        }
        // Clear callbacks
        this.changeCallbacks.length = 0;
    }

    /**
     * Check if the given file path represents a profile file (not a directory)
     */
    private async isProfileFile(filePath: string): Promise<boolean> {
        try {
            const uri = vscode.Uri.file(filePath);
            const stat = await vscode.workspace.fs.stat(uri);
            return stat.type === vscode.FileType.File;
        } catch (error) {
            // If we can't stat the file (e.g., it was deleted), assume it's not a file
            return false;
        }
    }

    private get logger() {
        return getLogger();
    }
}
