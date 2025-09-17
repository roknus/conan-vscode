import * as vscode from 'vscode';
import { Profile } from '../conan_store';

export class ConanProfileItem extends vscode.TreeItem {
    constructor(
        public readonly profile: Profile
    ) {
        super(profile.name, vscode.TreeItemCollapsibleState.None);
        
        this.contextValue = 'profile';
        this.iconPath = new vscode.ThemeIcon('person');
        
        const profileType = profile.isLocal ? 'Local' : 'Global';
        this.tooltip = `${profileType} Profile: ${profile.name}\nPath: ${profile.path}`;
        this.description = profile.isLocal ? '(local)' : '';
        this.resourceUri = vscode.Uri.file(profile.path);
    }
}
