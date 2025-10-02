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
export class ProfileFolderWatcher implements vscode.Disposable {
    private profileFolderWatcher: vscode.FileSystemWatcher | undefined;
    private disposables: vscode.Disposable[] = [];

    // Replace callback array with EventEmitter
    private readonly _onProfileFolderChange = new vscode.EventEmitter<ProfileFolderChangeEvent>();
    readonly onProfileFolderChange = this._onProfileFolderChange.event;

    constructor() {
    }

    /**
     * Dispose all watchers - implements vscode.Disposable
     */
    dispose(): void {
        this.profileFolderWatcher?.dispose();
        this._onProfileFolderChange.dispose();
        this.disposables.forEach(d => d.dispose());
    }

    /**
     * Initialize both global and local profile folder watchers
     */
    activate(path: string) {
        // Dispose existing watcher
        this.profileFolderWatcher?.dispose();
        this.disposables.forEach(d => d.dispose());

        try {
            this.profileFolderWatcher = this.createProfileFolderWatcher(path);
        } catch (error) {
            this.logger.warn(`Failed to create profile folder watcher: ${error}`);
        }
    }

    /**
     * Create a generic file system watcher for profile folders
     */
    private createProfileFolderWatcher(path: string): vscode.FileSystemWatcher {
        const pattern = `${path}/**`;
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);

        this.disposables.push(watcher,

            watcher.onDidCreate(async (uri) => {
                if (await this.isProfileFile(uri.fsPath)) {
                    this.logger.info(`Profile file created: ${uri.fsPath}`);
                    this._onProfileFolderChange.fire({
                        type: 'created',
                        filePath: uri.fsPath
                    });
                }
            }),

            watcher.onDidDelete(async (uri) => {
                // For deleted files, we can't stat them, so we'll use a simple heuristic
                // or assume the watcher only fires for files that existed before
                const fileName = uri.fsPath.split(/[/\\]/).pop() || '';
                const isFile = fileName.includes('.') && !fileName.endsWith('/') && !fileName.endsWith('\\');

                if (isFile) {
                    this.logger.info(`Profile file deleted: ${uri.fsPath}`);
                    this._onProfileFolderChange.fire({
                        type: 'deleted',
                        filePath: uri.fsPath
                    });
                }
            })
        );

        this.logger.info(`Profile folder watcher created for: ${pattern}`);
        return watcher;
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
