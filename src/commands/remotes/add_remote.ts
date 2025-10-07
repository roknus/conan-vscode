import * as vscode from 'vscode';
import { ConanApiClient } from "../../conan_api_client";
import { ConanStore } from "../../conan_store";
import { refreshRemotes } from "../commands";
import { loginRemote } from './login_remote';


export async function addRemote(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {
    if (conanStore.getServerState() !== 'running') {
        vscode.window.showErrorMessage('Conan API Server is not available.');
        return;
    }

    const remoteName = await vscode.window.showInputBox({
        prompt: 'Enter remote name',
        placeHolder: 'e.g., conancenter'
    });

    if (remoteName) {
        const remoteUrl = await vscode.window.showInputBox({
            prompt: 'Enter remote URL',
            placeHolder: 'e.g., https://center.conan.io'
        });

        if (remoteUrl) {
            try {
                const response = await apiClient.addRemote(remoteName, remoteUrl);
                vscode.window.showInformationMessage(`Remote '${remoteName}' added successfully`);

                if(response.requires_auth) {
                    await loginRemote(remoteName, apiClient);
                }

                // Clear remotes cache to force refresh
                conanStore.setRemotes([]);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to add remote: ${error}`);
            }
        }
    }

    // Clear remotes status after addition
    refreshRemotes(conanStore, apiClient);
}