// Simple test to verify the extension loads properly
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Conan Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should activate', async () => {
        // Test that the extension activates
        const ext = vscode.extensions.getExtension('conan-package-manager');
        assert.ok(ext);
        await ext?.activate();
        assert.ok(ext?.isActive);
    });

    test('Commands should be registered', async () => {
        // Test that commands are properly registered
        const commands = await vscode.commands.getCommands();
        
        assert.ok(commands.includes('conan.installRequirements'));
        assert.ok(commands.includes('conan.createProfile'));
        assert.ok(commands.includes('conan.addRemote'));
    });
});
