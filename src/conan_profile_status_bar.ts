import * as vscode from 'vscode';
import { Profile, ProfileType } from './conan_store';
import { getLogger } from './logger';

/**
 * Event data for active profile file changes
 */
export interface ActiveProfileChangeEvent {
    profileType: ProfileType;
    type: 'changed' | 'deleted';
    filePath: string;
}


// Profile status bar management
// Host Profile status bar management
function createProfileStatusBarItem(type: ProfileType): vscode.StatusBarItem {
    if (type === 'host') {
        const hostProfileStatusBarItem = vscode.window.createStatusBarItem('conan.hostProfile', vscode.StatusBarAlignment.Left, 42);
        hostProfileStatusBarItem.name = 'Conan Host Profile';
        hostProfileStatusBarItem.command = 'conan.selectHostProfile';
        hostProfileStatusBarItem.tooltip = 'Click to select active Conan host profile';
        hostProfileStatusBarItem.text = `$(person) Host: None`;
        hostProfileStatusBarItem.tooltip = `Active Conan Host Profile: None (click to change)`;
        return hostProfileStatusBarItem;
    } else {
        const buildProfileStatusBarItem = vscode.window.createStatusBarItem('conan.buildProfile', vscode.StatusBarAlignment.Left, 41);
        buildProfileStatusBarItem.name = 'Conan Build Profile';
        buildProfileStatusBarItem.command = 'conan.selectBuildProfile';
        buildProfileStatusBarItem.tooltip = 'Click to select active Conan build profile';
        buildProfileStatusBarItem.text = `$(tools) Build: None`;
        buildProfileStatusBarItem.tooltip = `Active Conan Build Profile: None (click to change)`;
        return buildProfileStatusBarItem;
    }
}

export class ProfileStatusBar implements vscode.Disposable {
    private profileType: ProfileType;
    private statusBarItem: vscode.StatusBarItem;
    private watcher: vscode.FileSystemWatcher | undefined;
    private disposables: vscode.Disposable[] = [];
    private _onProfileFileChange = new vscode.EventEmitter<ActiveProfileChangeEvent>();

    // Expose the event
    public readonly onProfileFileChange = this._onProfileFileChange.event;

    constructor(profileType: ProfileType) {
        this.profileType = profileType;
        this.statusBarItem = createProfileStatusBarItem(profileType);
    }

    dispose() {
        // Dispose everything
        this.statusBarItem.dispose();
        this.watcher?.dispose();
        this._onProfileFileChange.dispose();
        this.disposables.forEach(d => d.dispose());
    }

    activate() {
        this.statusBarItem.show();
    }

    deactivate() {
        this.statusBarItem.hide();
    }

    setProfile(profile: Profile | null) {
        // Dispose old watcher if any
        if (this.watcher) {
            this.watcher.dispose();
        }

        try {

            let profileName = 'None';
            if (profile) {
                profileName = profile.name;
            }
            if (this.profileType === 'host') {
                this.statusBarItem.text = `$(person) Host: ${profileName}`;
                this.statusBarItem.tooltip = `Active Conan Host Profile: ${profileName} (click to change)`;
            }
            else if (this.profileType === 'build') {
                this.statusBarItem.text = `$(tools) Build: ${profileName}`;
                this.statusBarItem.tooltip = `Active Conan Build Profile: ${profileName} (click to change)`;
            }

            if (!profile || !profile.path) {
                return;
            }

            const profileUri = vscode.Uri.file(profile.path);
            this.watcher = vscode.workspace.createFileSystemWatcher(profileUri.fsPath);

            this.disposables.push(

                this.watcher.onDidChange(() => {
                    this.logger.info(`${this.profileType} profile file changed: ${profile.path}`);
                    this._onProfileFileChange.fire({
                        profileType: this.profileType,
                        type: 'changed',
                        filePath: profile.path
                    });
                }),

                this.watcher.onDidDelete(() => {
                    this.logger.warn(`${this.profileType} profile file deleted: ${profile.path}`);
                    this._onProfileFileChange.fire({
                        profileType: this.profileType,
                        type: 'deleted',
                        filePath: profile.path
                    });
                })
            );

            this.logger.info(`${this.profileType} profile watcher created for: ${profile.path}`);
        } catch (error) {
            this.logger.warn(`Failed to create ${this.profileType} profile watcher: ${error}`);
        }
    }

    private get logger() {
        return getLogger();
    }
}
