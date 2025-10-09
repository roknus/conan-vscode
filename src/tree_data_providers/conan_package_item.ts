import * as vscode from 'vscode';
import { PackageInfo, PackageItemType, Remote } from '../conan_store';

function get_ref(pkg: PackageInfo): string {
    return `${pkg.name}/${pkg.version}`;
}

export class ConanPackageItem extends vscode.TreeItem {

    get ref(): string {
        return get_ref(this.packageInfo);
    }

    constructor(
        public readonly packageInfo: PackageInfo,
        public readonly activeRemote: Remote | 'all',
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemType: PackageItemType
    ) {
        super(get_ref(packageInfo), collapsibleState);

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

            let tooltip = `${header}\n`;
            tooltip += `🔗 ID: ${packageInfo.id}\n\n`;

            // Local availability
            tooltip += `📁 Local:\n`;
            tooltip += `\t🔨 Recipe: ${avail.local_status.recipe_status === 'cache' ? '✅' : '❌'}\n`;
            tooltip += `\t📦 Binary: ${avail.local_status.binary_status === 'cache' ? '✅' : '❌'}\n`;

            // Enhanced remote availability info
            tooltip += `🌐 Remotes:\n`;
            for (const remoteStatus of avail.remotes_status) {
                const isActiveRemote = (activeRemote !== 'all' && remoteStatus.remote_name === activeRemote.name);
                const remoteLabel = isActiveRemote ? `${remoteStatus.remote_name} (active)` : remoteStatus.remote_name;
                tooltip += `\t- ${remoteLabel}:\n`;
                tooltip += `\t\t🔨 Recipe: ${remoteStatus.recipe_status === 'available' ? '✅' : '❌'}\n`;
                tooltip += `\t\t📦 Binary: ${remoteStatus.binary_status === 'available' ? '✅' : '❌'}\n`;
            }

            // Only show incompatible warning if it's actually incompatible
            if (avail.is_incompatible) {
                tooltip += `\n⚠️ Package is incompatible with current profile\nReason: ${avail.incompatible_reason || 'Unknown reason'}\n`;
            }

            this.tooltip = tooltip;
        } else {
            this.tooltip = this.ref;
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
