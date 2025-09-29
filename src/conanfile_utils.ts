import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ConanfileInfo {
    hasPyFile: boolean;
    hasTxtFile: boolean;
    preferredFile: 'conanfile.py' | 'conanfile.txt' | null;
    preferredPath: string | null;
    hasAnyConanfile: boolean;
}

/**
 * Detect conanfiles in the workspace and determine which one to use
 */
export function detectConanfiles(workspaceRoot: string): ConanfileInfo {
    const pyPath = path.join(workspaceRoot, 'conanfile.py');
    const txtPath = path.join(workspaceRoot, 'conanfile.txt');
    
    const hasPyFile = fs.existsSync(pyPath);
    const hasTxtFile = fs.existsSync(txtPath);
    const hasAnyConanfile = hasPyFile || hasTxtFile;
    
    let preferredFile: 'conanfile.py' | 'conanfile.txt' | null = null;
    let preferredPath: string | null = null;
    
    if (hasAnyConanfile) {
        // Get user preference from configuration
        const config = vscode.workspace.getConfiguration('conan');
        const preferredFormat = config.get<string>('preferredConanfileFormat', 'py');
        
        if (hasPyFile && hasTxtFile) {
            // Both files exist, use preference
            if (preferredFormat === 'py') {
                preferredFile = 'conanfile.py';
                preferredPath = pyPath;
            } else {
                preferredFile = 'conanfile.txt';
                preferredPath = txtPath;
            }
        } else if (hasPyFile) {
            // Only .py file exists
            preferredFile = 'conanfile.py';
            preferredPath = pyPath;
        } else if (hasTxtFile) {
            // Only .txt file exists
            preferredFile = 'conanfile.txt';
            preferredPath = txtPath;
        }
    }
    
    return {
        hasPyFile,
        hasTxtFile,
        preferredFile,
        preferredPath,
        hasAnyConanfile
    };
}

/**
 * Get the glob pattern for watching both conanfile types
 */
export function getConanfileWatchPattern(workspaceRoot: string): string {
    return path.join(workspaceRoot, 'conanfile.{py,txt}');
}

/**
 * Determine if the changed file affects conanfile detection
 */
export function isConanfileChange(changedPath: string): boolean {
    const fileName = path.basename(changedPath);
    return fileName === 'conanfile.py' || fileName === 'conanfile.txt';
}