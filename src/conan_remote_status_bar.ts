import * as vscode from 'vscode';
import { AllRemotes, Remote } from './conan_store';



// Remote status bar management
function createRemoteStatusBarItem(): vscode.StatusBarItem {
    const remoteStatusBarItem = vscode.window.createStatusBarItem('conan.remote', vscode.StatusBarAlignment.Left, 40);
    remoteStatusBarItem.name = 'Conan Remote';
    remoteStatusBarItem.command = 'conan.selectRemote';
    remoteStatusBarItem.tooltip = 'Click to select active Conan remote';
    return remoteStatusBarItem;
}

export class RemoteStatusBar implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;

    constructor() {
        this.statusBarItem = createRemoteStatusBarItem();
    }

    dispose() {
        // Dispose everything
        this.statusBarItem.dispose();
    }

    activate() {
        this.statusBarItem.show();
    }

    deactivate() {
        this.statusBarItem.hide();
    }

    setRemote(remote: Remote | AllRemotes) {
        let remoteName = 'all';
        if (remote !== 'all') {
            remoteName = remote.name;
        }
        this.statusBarItem.text = `$(globe) ${remoteName}`;
        this.statusBarItem.tooltip = `Active Conan Remote: ${remoteName} (click to change)`;
    }
}
