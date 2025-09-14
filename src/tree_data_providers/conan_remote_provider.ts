import * as vscode from 'vscode';
import { ConanStore } from '../conan_store';
import { ConanRemoteItem } from './conan_remote_item';
import { getLogger } from '../logger';

export class ConanRemoteProvider implements vscode.TreeDataProvider<ConanRemoteItem | vscode.TreeItem> {
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

    getTreeItem(element: ConanRemoteItem | vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<(vscode.TreeItem)[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            return this.getConanRemotes();
        }
    }

    private async getConanRemotes(): Promise<(vscode.TreeItem)[]> {
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
                    const remotes = this.conanStore.getRemotes();
                    if (!remotes || remotes.length === 0) {
                        const item = new vscode.TreeItem('Conan API Server failed to start', vscode.TreeItemCollapsibleState.None);
                        item.iconPath = new vscode.ThemeIcon('error');
                        item.contextValue = 'error';
                        item.tooltip = 'Conan API Server failed to start';
                        item.description = '';
                        return [item];
                    }
                    return remotes.map(remote => new ConanRemoteItem({ name: remote.name, url: remote.url }));
                } catch (error) {
                    getLogger().warn('Remote API request failed:', error);
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