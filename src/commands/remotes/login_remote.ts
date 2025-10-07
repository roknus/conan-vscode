import * as vscode from 'vscode';
import { ConanApiClient } from '../../conan_api_client';

export async function loginRemote(remoteName: string, apiClient: ConanApiClient): Promise<void> {

    const login = await vscode.window.showInputBox({
        prompt: `Remote '${remoteName}' requires authentication. Enter username:`
    });

    if (login) {
        const password = await vscode.window.showInputBox({
            prompt: `Enter password for '${login}':`,
            password: true
        });

        if (password) {
            try {
                await apiClient.loginRemote(remoteName, login, password);
                vscode.window.showInformationMessage(`Authenticated to remote '${remoteName}' successfully`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to authenticate to remote '${remoteName}': ${error}`);
            }
        }
    }
}