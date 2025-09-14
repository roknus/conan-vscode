import * as vscode from 'vscode';
import { Remote } from '../conan_store';

export class ConanRemoteItem extends vscode.TreeItem {
    constructor(
        public readonly remote: Remote
    ) {
        super(remote.name, vscode.TreeItemCollapsibleState.None);
        
        this.contextValue = 'remote';
        this.iconPath = new vscode.ThemeIcon('globe');
        this.tooltip = `Remote: ${remote.name}\nURL: ${remote.url}`;
        this.description = remote.url;
    }
}
