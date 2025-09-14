import * as vscode from 'vscode';

let logger: vscode.LogOutputChannel;

export function initializeLogger(loggerInstance: vscode.LogOutputChannel): void {
    logger = loggerInstance;
}

export function getLogger(): vscode.LogOutputChannel {
    if (!logger) {
        throw new Error('Logger not initialized. Call initializeLogger first.');
    }
    return logger;
}
