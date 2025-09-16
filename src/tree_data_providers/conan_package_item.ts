import * as vscode from 'vscode';
import { PackageInfo } from '../conan_store';

// Valid item types for package tree items only
export type PackageItemType =
    | 'package-available'
    | 'package-downloadable'
    | 'package-uploadable'
    | 'package-buildable'
    | 'package-incompatible'
    | 'package-unknown'
    | 'package-installing'
    | 'package-uploading';

export class ConanPackageItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemType: PackageItemType,
        public readonly packageInfo?: PackageInfo
    ) {
        super(label, collapsibleState);

        // Create detailed tooltip for packages with availability information
        if (itemType.startsWith('package') && packageInfo && packageInfo.availability) {
            const avail = packageInfo.availability;

            let header = this.label;
            switch (itemType) {
                case 'package-available':
                    header += ' (available)';
                    break;
                case 'package-uploadable':
                    header += ' (available for upload)';
                    break;
                case 'package-downloadable':
                    header += ' (available for download)';
                    break;
                case 'package-buildable':
                    header += ' (buildable from recipe)';
                    break;
                case 'package-incompatible':
                    header += ' (incompatible with current profile)';
                    break;
                case 'package-unknown':
                    header += ' (status unknown)';
                    break;
                case 'package-installing':
                    header += ' (installing...)';
                    break;
                case 'package-uploading':
                    header += ' (uploading...)';
                    break;
            }

            let tooltip = `${header}\n\n`;

            // Local availability
            tooltip += `📁 Local:\n`;
            tooltip += `\t🔨 Recipe: ${avail.local_status.startsWith('recipe') ? '✅' : '❌'}\n`;
            tooltip += `\t📦 Binary: ${avail.local_status === 'recipe+binary' ? '✅' : '❌'}\n`;

            // Enhanced remote availability info
            tooltip += `🌐 Remote:\n`;
            tooltip += `\t🔨 Recipe: ${avail.remote_status.startsWith('recipe') ? '✅' : '❌'}\n`;
            tooltip += `\t📦 Binary: ${avail.remote_status === 'recipe+binary' ? '✅' : '❌'}\n`;

            // Only show incompatible warning if it's actually incompatible
            if (avail.is_incompatible) {
                tooltip += `\n⚠️ Package is incompatible with current profile\nReason: ${avail.incompatible_reason || 'Unknown reason'}\n`;
            }

            this.tooltip = tooltip;
        } else {
            this.tooltip = this.label;
        }

        // Set context value for menu contributions
        this.contextValue = itemType;

        switch (itemType) {
            case 'package-available':
                this.iconPath = new vscode.ThemeIcon('layers-active');
                break;
            case 'package-uploadable':
                this.iconPath = new vscode.ThemeIcon('layers-dot');
                break;
            case 'package-downloadable':
                this.iconPath = new vscode.ThemeIcon('cloud-download');
                break;
            case 'package-buildable':
                this.iconPath = new vscode.ThemeIcon('tools');
                break;
            case 'package-incompatible':
                this.iconPath = new vscode.ThemeIcon('error');
                break;
            case 'package-unknown':
                this.iconPath = new vscode.ThemeIcon('question');
                break;
            case 'package-installing':
                this.iconPath = new vscode.ThemeIcon('loading~spin');
                break;
            case 'package-uploading':
                this.iconPath = new vscode.ThemeIcon('loading~spin');
                break;
        }
    }
}
