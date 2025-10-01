import * as vscode from 'vscode';
import { ConanStore } from '../conan_store';
import { ConanProfileItem } from './conan_profile_item';
import { getLogger } from '../logger';

class ProfileSectionItem extends vscode.TreeItem {
    constructor(label: string, isLocalSection: boolean) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = isLocalSection ? 'local' : 'global';
        this.tooltip = isLocalSection ? 'Local workspace profiles' : 'Global Conan profiles';
    }
}

export class ConanProfileProvider implements vscode.TreeDataProvider<ConanProfileItem | ProfileSectionItem | vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

    constructor(private conanStore: ConanStore) {
        // Register for server state changes
        this.conanStore.subscribe(state => state.serverState, () => {
            this._onDidChangeTreeData.fire();
        });
        
        // Register for profiles state changes
        this.conanStore.subscribe(state => state.profiles, () => {
            this._onDidChangeTreeData.fire();
        });
    }

    getTreeItem(element: ConanProfileItem | ProfileSectionItem | vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConanProfileItem | ProfileSectionItem | vscode.TreeItem): Thenable<(ConanProfileItem | ProfileSectionItem | vscode.TreeItem)[]> {
        if (element instanceof ProfileSectionItem) {
            return this.getProfilesForSection(element.contextValue === 'local');
        } else if (element) {
            return Promise.resolve([]);
        } else {
            return this.getProfileSections();
        }
    }

    private async getProfileSections(): Promise<(ProfileSectionItem | vscode.TreeItem)[]> {
        const serverState = this.conanStore.getServerState();

        switch (serverState) {
            case 'starting': {
                const item = new vscode.TreeItem('Conan API Server is starting...', vscode.TreeItemCollapsibleState.None);
                item.iconPath = new vscode.ThemeIcon('info');
                item.contextValue = 'info';
                item.tooltip = 'Conan API Server is starting...';
                item.description = '';
                return [item];
            }

            case 'running':
                try {
                    const sections: ProfileSectionItem[] = [];

                    // Always show both sections
                    sections.push(new ProfileSectionItem('Global', false));
                    sections.push(new ProfileSectionItem('Local', true));

                    return sections;
                } catch (error) {
                    getLogger().warn('Profile API request failed:', error);
                    const item = new vscode.TreeItem(`API Error: ${error}`, vscode.TreeItemCollapsibleState.None);
                    item.iconPath = new vscode.ThemeIcon('error');
                    item.contextValue = 'error';
                    item.tooltip = `API Error: ${error}`;
                    item.description = '';
                    return [item];
                }

            case 'error': {
                const item = new vscode.TreeItem('Conan API Server failed to start', vscode.TreeItemCollapsibleState.None);
                item.iconPath = new vscode.ThemeIcon('error');
                item.contextValue = 'error';
                item.tooltip = 'Conan API Server failed to start';
                item.description = '';
                return [item];
            }

            case 'stopped':
            default: {
                const item = new vscode.TreeItem('Conan API Server is not available', vscode.TreeItemCollapsibleState.None);
                item.iconPath = new vscode.ThemeIcon('info');
                item.contextValue = 'info';
                item.tooltip = 'Conan API Server is not available';
                item.description = '';
                return [item];
            }
        }
    }

    private async getProfilesForSection(isLocalSection: boolean): Promise<(ConanProfileItem | vscode.TreeItem)[]> {
        const profiles = this.conanStore.getProfiles();

        if (!profiles) {
            const item = new vscode.TreeItem('Loading profiles...', vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('info');
            item.contextValue = 'info';
            item.tooltip = 'Loading profiles...';
            item.description = '';
            return [item];
        }

        const filteredProfiles = profiles.filter(profile => {
            return isLocalSection ? profile.isLocal === true : profile.isLocal !== true;
        });

        if (filteredProfiles.length === 0) {
            const sectionType = isLocalSection ? 'local' : 'global';
            const item = new vscode.TreeItem(`No ${sectionType} profiles found`, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('info');
            item.contextValue = 'info';
            item.tooltip = `No ${sectionType} profiles found`;
            item.description = '';
            return [item];
        }

        return filteredProfiles.map(profile => new ConanProfileItem(profile));
    }
}