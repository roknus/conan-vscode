import * as vscode from 'vscode';
import { Profile } from '../conan_store';

export class ConanProfileItem extends vscode.TreeItem {
    constructor(
        public readonly profile: Profile
    ) {
        super(profile.name, vscode.TreeItemCollapsibleState.None);
        
        this.contextValue = 'profile';
        this.iconPath = new vscode.ThemeIcon('person');
        this.tooltip = `Profile: ${profile.name}\nPath: ${profile.path}`;
        this.resourceUri = vscode.Uri.file(profile.path);
    }
}
