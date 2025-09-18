import * as vscode from 'vscode';
import { ConanStore, PackageInfo, PackageItemType } from '../conan_store';
import { ConanPackageItem } from './conan_package_item';
import { getLogger } from '../logger';

export class ConanPackageProvider implements vscode.TreeDataProvider<ConanPackageItem | vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

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

    getTreeItem(element: ConanPackageItem | vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ConanPackageItem | vscode.TreeItem): Promise<(ConanPackageItem | vscode.TreeItem)[]> {
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

    private async getConanPackages(): Promise<(ConanPackageItem | vscode.TreeItem)[]> {
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
                    const packages = this.conanStore.getPackages();
                    if (!packages) {
                        const item = new vscode.TreeItem('Loading packages...', vscode.TreeItemCollapsibleState.None);
                        item.iconPath = new vscode.ThemeIcon('info');
                        item.contextValue = 'info';
                        item.tooltip = 'Loading packages...';
                        item.description = '';
                        return [item];
                    }

                    return packages.map(pkg => {
                        // Check if this package is currently being processed
                        const loadingType = this.conanStore.getPackageLoadingType(pkg.ref);
                        const itemType = loadingType || this.getItemTypeFromPackage(pkg);

                        return new ConanPackageItem(`${pkg.name}/${pkg.version}`, vscode.TreeItemCollapsibleState.None, itemType, pkg);
                    });
                } catch (error) {
                    this.logger.warn('Package API request failed:', error);

                    // Check if the error is about missing profiles
                    if (error && typeof error === 'object' && 'message' in error) {
                        const errorMessage = (error as any).message || error.toString();
                        if (errorMessage.includes('select host and build profiles') || errorMessage.includes('profiles are required')) {
                            const item = new vscode.TreeItem('Please select host and build profiles first', vscode.TreeItemCollapsibleState.None);
                            item.iconPath = new vscode.ThemeIcon('warning');
                            item.contextValue = 'warning';
                            item.tooltip = 'Please select host and build profiles first';
                            item.description = '';
                            return [item];
                        }
                    }

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

    private getItemTypeFromPackage(pkg: PackageInfo): PackageItemType {
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