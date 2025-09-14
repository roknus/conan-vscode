import * as vscode from 'vscode';
import { ConanStore, PackageInfo } from '../conan_store';
import { ConanItem, ItemType } from './conan_item';
import { getLogger } from '../logger';

export class ConanPackageProvider implements vscode.TreeDataProvider<ConanItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ConanItem | undefined | null | void> = new vscode.EventEmitter<ConanItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ConanItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private conanStore: ConanStore) {
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

    async getChildren(element?: ConanItem): Promise<ConanItem[]> {
        if (!this.conanStore.workspaceRoot) {
            vscode.window.showInformationMessage('No Conan packages in empty workspace');
            return Promise.resolve([]);
        }

        if (element) {
            return Promise.resolve([]);
        } else {
            return this.getConanPackages();
        }
    }

    private async getConanPackages(): Promise<ConanItem[]> {
        const serverState = this.conanStore.getServerState();

        switch (serverState) {
            case 'starting':
                return [new ConanItem('Conan API Server is starting...', vscode.TreeItemCollapsibleState.None, 'info')];

            case 'running':
                try {
                    const packages = this.conanStore.getPackages();
                    if (!packages) {
                        return [new ConanItem('Loading packages...', vscode.TreeItemCollapsibleState.None, 'info')];
                    }

                    return packages.map(pkg => {
                        // Check if this package is currently being processed
                        const loadingType = this.conanStore.getPackageLoadingType(pkg.ref);
                        const itemType = loadingType || this.getItemTypeFromPackage(pkg);

                        return new ConanItem(pkg.name, vscode.TreeItemCollapsibleState.None, itemType, pkg);
                    });
                } catch (error) {
                    this.logger.warn('Package API request failed:', error);

                    // Check if the error is about missing profiles
                    if (error && typeof error === 'object' && 'message' in error) {
                        const errorMessage = (error as any).message || error.toString();
                        if (errorMessage.includes('select host and build profiles') || errorMessage.includes('profiles are required')) {
                            return [new ConanItem('Please select host and build profiles first', vscode.TreeItemCollapsibleState.None, 'warning')];
                        }
                    }

                    return [new ConanItem(`API Error: ${error}`, vscode.TreeItemCollapsibleState.None, 'error')];
                }

            case 'error':
                return [new ConanItem('Conan API Server failed to start', vscode.TreeItemCollapsibleState.None, 'error')];

            case 'stopped':
            default:
                return [new ConanItem('Conan API Server is not available', vscode.TreeItemCollapsibleState.None, 'info')];
        }
    }

    private getItemTypeFromPackage(pkg: PackageInfo): ItemType {
        const availability = pkg.availability;

        if (availability.is_incompatible) {
            return 'package-incompatible';
        } else if (availability.local_status === 'recipe+binary' && availability.remote_status === 'recipe+binary') {
            return 'package-available'; // Package available both remotely and locally
        } else if (availability.local_status === 'recipe+binary' && availability.remote_status !== 'recipe+binary') {
            return 'package-uploadable'; // Package available for upload
        } else if (availability.remote_status === 'recipe+binary' && availability.local_status !== 'recipe+binary') {
            return 'package-downloadable'; // Package available for download
        } else if (availability.local_status === 'recipe' || availability.remote_status === 'recipe') {
            return 'package-buildable'; // Recipe available, can build locally
        } else {
            return 'package-unknown';
        }
    }

    private get logger() {
        return getLogger();
    }
}