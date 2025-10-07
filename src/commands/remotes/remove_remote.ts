import * as vscode from 'vscode';
import { ConanApiClient } from '../../conan_api_client';

export async function removeRemote(remoteName: string, apiClient: ConanApiClient): Promise<void> {
    try {
        await apiClient.removeRemote(remoteName);
        vscode.window.showInformationMessage(`Remote '${remoteName}' removed successfully`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to remove remote '${remoteName}': ${error}`);
    }
}