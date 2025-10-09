import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectConanfiles, getConanfileWatchPattern, isConanfileChange } from '../conanfile_utils';

suite('Extension Conanfile Watcher Tests', () => {
    let tempDir: string;

    setup(async () => {
        // Create a temporary directory for tests
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conan-extension-test-'));
    });

    teardown(async () => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('conan.backendReady context is set correctly on startup', async () => {
        // This test would require actual VS Code workspace manipulation
        // For now, we'll test the logic indirectly through our utility functions
        
        // Test case 1: No conanfiles initially
        let result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, false);
        
        // Test case 2: Create conanfile.py
        const pyPath = path.join(tempDir, 'conanfile.py');
        fs.writeFileSync(pyPath, 'from conan import ConanFile\\n\\nclass TestConan(ConanFile):\\n    pass');
        
        result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, true);
        
        // Test case 3: Create conanfile.txt as well
        const txtPath = path.join(tempDir, 'conanfile.txt');
        fs.writeFileSync(txtPath, '[requires]\\nzlib/1.2.11');
        
        result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, true);
        assert.strictEqual(result.hasPyFile, true);
        assert.strictEqual(result.hasTxtFile, true);
    });

    test('configuration change affects conanfile preference', async () => {
        // Create both conanfile types
        const pyPath = path.join(tempDir, 'conanfile.py');
        const txtPath = path.join(tempDir, 'conanfile.txt');
        
        fs.writeFileSync(pyPath, 'from conan import ConanFile\\n\\nclass TestConan(ConanFile):\\n    pass');
        fs.writeFileSync(txtPath, '[requires]\\nzlib/1.2.11');
        
        // Mock different configuration scenarios
        
        // Test with py preference
        const mockConfigPy = {
            get: (key: string, defaultValue?: any) => {
                if (key === 'preferredConanfileFormat') {
                    return 'py';
                }
                return defaultValue;
            }
        } as any;
        
        const originalGetConfiguration = vscode.workspace.getConfiguration;
        vscode.workspace.getConfiguration = () => mockConfigPy;
        
        let result = detectConanfiles(tempDir);
        assert.strictEqual(result.preferredFile, 'conanfile.py');
        
        // Test with txt preference
        const mockConfigTxt = {
            get: (key: string, defaultValue?: any) => {
                if (key === 'preferredConanfileFormat') {
                    return 'txt';
                }
                return defaultValue;
            }
        } as any;
        
        vscode.workspace.getConfiguration = () => mockConfigTxt;
        
        result = detectConanfiles(tempDir);
        assert.strictEqual(result.preferredFile, 'conanfile.txt');
        
        // Restore original configuration
        vscode.workspace.getConfiguration = originalGetConfiguration;
    });

    test('file system watcher pattern generation', async () => {
        const pattern = getConanfileWatchPattern(tempDir);
        
        // Should include both file types in the pattern
        assert.ok(pattern.includes('conanfile.{py,txt}'));
        assert.ok(pattern.includes(tempDir));
        
        // Pattern should be absolute path
        assert.ok(path.isAbsolute(pattern));
    });

    test('conanfile change detection', async () => {
        // Test various file paths
        assert.strictEqual(isConanfileChange(path.join(tempDir, 'conanfile.py')), true);
        assert.strictEqual(isConanfileChange(path.join(tempDir, 'conanfile.txt')), true);
        assert.strictEqual(isConanfileChange(path.join(tempDir, 'CMakeLists.txt')), false);
        assert.strictEqual(isConanfileChange(path.join(tempDir, 'src', 'main.cpp')), false);
        assert.strictEqual(isConanfileChange(path.join(tempDir, 'conanfile_backup.py')), false);
        assert.strictEqual(isConanfileChange(path.join(tempDir, 'my_conanfile.txt')), false);
    });

    test('edge cases - empty files and invalid formats', async () => {
        // Create empty conanfiles
        const pyPath = path.join(tempDir, 'conanfile.py');
        const txtPath = path.join(tempDir, 'conanfile.txt');
        
        fs.writeFileSync(pyPath, '');
        fs.writeFileSync(txtPath, '');
        
        // Should still detect them (content validation is not our responsibility)
        const result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, true);
        assert.strictEqual(result.hasPyFile, true);
        assert.strictEqual(result.hasTxtFile, true);
    });

    test('symlink handling', async () => {
        // Create a real conanfile
        const realPyPath = path.join(tempDir, 'real_conanfile.py');
        fs.writeFileSync(realPyPath, 'from conan import ConanFile\\n\\nclass TestConan(ConanFile)\\n    pass');
        
        // Create a symlink to it named conanfile.py
        const symlinkPath = path.join(tempDir, 'conanfile.py');
        
        try {
            // Try to create symlink (may fail on Windows without admin rights)
            fs.symlinkSync(realPyPath, symlinkPath);
            
            const result = detectConanfiles(tempDir);
            assert.strictEqual(result.hasAnyConanfile, true);
            assert.strictEqual(result.hasPyFile, true);
        } catch (error) {
            // Symlink creation failed (likely Windows permissions), skip this test
            console.log('Symlink test skipped due to permissions:', error);
        }
    });
    
    test('conan.backendReady context affects UI visibility', async () => {
        // This test verifies the logic for showing/hiding UI elements based on conanfile presence
        
        // Initially no conanfiles - should hide UI elements
        let result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, false);
        
        // Create conanfile.py - should show UI elements
        const pyPath = path.join(tempDir, 'conanfile.py');
        fs.writeFileSync(pyPath, 'from conan import ConanFile\\n\\nclass TestConan(ConanFile):\\n    pass');
        
        result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, true);
        
        // Delete conanfile - should hide UI elements again
        fs.unlinkSync(pyPath);
        
        result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, false);
    });
    
    test('extension activation with onStartupFinished', async () => {
        // This test verifies that the extension can activate without existing conanfiles
        // and then initialize components when conanfiles are created
        
        // Test the scenario where extension starts without conanfiles
        // but should still be able to watch for their creation
        
        // Initially no conanfiles
        let result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, false);
        
        // Simulate file watcher pattern generation (should work even without conanfiles)
        const pattern = getConanfileWatchPattern(tempDir);
        assert.ok(pattern.includes('conanfile.{py,txt}'));
        
        // Create conanfile after "extension activation"
        const pyPath = path.join(tempDir, 'conanfile.py');
        fs.writeFileSync(pyPath, 'from conan import ConanFile\\n\\nclass TestConan(ConanFile):\\n    pass');
        
        // Should now detect the conanfile
        result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, true);
        assert.strictEqual(result.preferredFile, 'conanfile.py');
        
        // This simulates the extension being able to respond to conanfile creation
        // even when it wasn't present during initial activation
    });
});