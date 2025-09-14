import * as vscode from 'vscode';
import { ConanStore } from '../conan_store';
import { ConanProfileItem } from './conan_profile_item';
import { getLogger } from '../logger';

export class ConanProfileProvider implements vscode.TreeDataProvider<ConanProfileItem | vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

    constructor(private conanStore: ConanStore) {
        // Register for server state changes
        this.conanStore.onServerStateChange((state) => {
            this._onDidChangeTreeData.fire();
        });

        // Register for data changes
        this.conanStore.onDataChange(() => {
            this._onDidChangeTreeData.fire();
        });

        // Register for task state changes
        this.conanStore.onTaskStateChange(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    getTreeItem(element: ConanProfileItem | vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConanProfileItem | vscode.TreeItem): Thenable<(ConanProfileItem | vscode.TreeItem)[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            return this.getConanProfiles();
        }
    }

    private async getConanProfiles(): Promise<(ConanProfileItem | vscode.TreeItem)[]> {
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
                    const profiles = this.conanStore.getProfiles();
                    if (!profiles || profiles.length === 0) {
                        const item = new vscode.TreeItem('No profiles found', vscode.TreeItemCollapsibleState.None);
                        item.iconPath = new vscode.ThemeIcon('info');
                        item.contextValue = 'info';
                        item.tooltip = 'No profiles found';
                        item.description = '';
                        return [item];
                    }
                    return profiles.map(profile => new ConanProfileItem(profile));
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
}