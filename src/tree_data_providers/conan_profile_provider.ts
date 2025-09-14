import * as vscode from 'vscode';
import { ConanStore } from '../conan_store';
import { ConanItem } from './conan_item';
import { getLogger } from '../logger';

export class ConanProfileProvider implements vscode.TreeDataProvider<ConanItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ConanItem | undefined | null | void> = new vscode.EventEmitter<ConanItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ConanItem | undefined | null | void> = this._onDidChangeTreeData.event;

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

    getTreeItem(element: ConanItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConanItem): Thenable<ConanItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            return this.getConanProfiles();
        }
    }

    private async getConanProfiles(): Promise<ConanItem[]> {
        const serverState = this.conanStore.getServerState();

        switch (serverState) {
            case 'starting':
                return [new ConanItem('Conan API Server is starting...', vscode.TreeItemCollapsibleState.None, 'info')];

            case 'running':
                try {
                    const profiles = this.conanStore.getProfiles();
                    if (!profiles || profiles.length === 0) {
                        return [new ConanItem('No profiles found', vscode.TreeItemCollapsibleState.None, 'info')];
                    }
                    return profiles.map(profile => new ConanItem(profile.name, vscode.TreeItemCollapsibleState.None, 'profile'));
                } catch (error) {
                    getLogger().warn('Profile API request failed:', error);
                    return [new ConanItem(`API Error: ${error}`, vscode.TreeItemCollapsibleState.None, 'error')];
                }

            case 'error':
                return [new ConanItem('Conan API Server failed to start', vscode.TreeItemCollapsibleState.None, 'error')];

            case 'stopped':
            default:
                return [new ConanItem('Conan API Server is not available', vscode.TreeItemCollapsibleState.None, 'info')];
        }
    }
}