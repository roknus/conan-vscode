import * as vscode from 'vscode';
import { AllRemotes, ConanStore, Remote } from "../../conan_store";


/**
 * QuickPickItem that stores either a Remote object or 'all' string
 */
export interface RemoteQuickPickItem extends vscode.QuickPickItem {
    // Store either a Remote object or 'all'
    remote: Remote | AllRemotes;
}

export async function selectRemote(conanStore: ConanStore): Promise<void> {
    try {
        // Always use API - require server to be running
        if (conanStore.getServerState() !== 'running') {
            vscode.window.showErrorMessage('Conan API Server is not available.');
            return;
        }

        const remotes = conanStore.getRemotes();

        if (!remotes) {
            vscode.window.showErrorMessage('No remotes found. Please add a remote first.');
            return;
        }


        // Show quick pick with current remote highlighted
        let quickPickItems: RemoteQuickPickItem[] = remotes.map(remote => ({
            label: remote.name,
            description: remote.name === conanStore.activeRemote ? '$(check) Current' : remote.url,
            remote: remote
        }));
        
        // Add "all" option
        quickPickItems = [
            { label: 'all', description: 'All configured remotes', remote: 'all' },
            ...quickPickItems
        ];

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select active Conan remote',
            matchOnDescription: true
        });

        if (selected && selected.remote !== conanStore.activeRemote) {
            conanStore.activeRemote = selected.remote;

            vscode.window.showInformationMessage(`Active Conan remote set to: ${conanStore.activeRemote}`);

            // Save configuration
            await conanStore.saveConfiguration();
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to select remote: ${error}`);
    }
}