import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectConanfiles, getConanfileWatchPattern, isConanfileChange } from '../conanfile_utils';

suite('ConanfileUtils Test Suite', () => {
    let tempDir: string;
    let originalConfig: vscode.WorkspaceConfiguration;

    setup(async () => {
        // Create a temporary directory for tests
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conan-test-'));
        
        // Mock workspace configuration
        originalConfig = vscode.workspace.getConfiguration('conan');
    });

    teardown(async () => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('detectConanfiles - no conanfiles', () => {
        const result = detectConanfiles(tempDir);
        
        assert.strictEqual(result.hasPyFile, false);
        assert.strictEqual(result.hasTxtFile, false);
        assert.strictEqual(result.hasAnyConanfile, false);
        assert.strictEqual(result.preferredFile, null);
        assert.strictEqual(result.preferredPath, null);
    });

    test('detectConanfiles - only conanfile.py', () => {
        const pyPath = path.join(tempDir, 'conanfile.py');
        fs.writeFileSync(pyPath, 'from conan import ConanFile\n\nclass TestConan(ConanFile):\n    pass');
        
        const result = detectConanfiles(tempDir);
        
        assert.strictEqual(result.hasPyFile, true);
        assert.strictEqual(result.hasTxtFile, false);
        assert.strictEqual(result.hasAnyConanfile, true);
        assert.strictEqual(result.preferredFile, 'conanfile.py');
        assert.strictEqual(result.preferredPath, pyPath);
    });

    test('detectConanfiles - only conanfile.txt', () => {
        const txtPath = path.join(tempDir, 'conanfile.txt');
        fs.writeFileSync(txtPath, '[requires]\\nzlib/1.2.11\\n[generators]\\nCMakeDeps\\nCMakeToolchain');
        
        const result = detectConanfiles(tempDir);
        
        assert.strictEqual(result.hasPyFile, false);
        assert.strictEqual(result.hasTxtFile, true);
        assert.strictEqual(result.hasAnyConanfile, true);
        assert.strictEqual(result.preferredFile, 'conanfile.txt');
        assert.strictEqual(result.preferredPath, txtPath);
    });

    test('detectConanfiles - both files, prefer py (default)', async () => {
        const pyPath = path.join(tempDir, 'conanfile.py');
        const txtPath = path.join(tempDir, 'conanfile.txt');
        
        fs.writeFileSync(pyPath, 'from conan import ConanFile\\n\\nclass TestConan(ConanFile):\\n    pass');
        fs.writeFileSync(txtPath, '[requires]\\nzlib/1.2.11\\n[generators]\\nCMakeDeps\\nCMakeToolchain');
        
        // Mock configuration to return default preference (py)
        const mockConfig = {
            get: (key: string, defaultValue?: any) => {
                if (key === 'preferredConanfileFormat') {
                    return 'py';
                }
                return defaultValue;
            }
        } as any;
        
        // Override workspace configuration temporarily
        const originalGetConfiguration = vscode.workspace.getConfiguration;
        vscode.workspace.getConfiguration = () => mockConfig;
        
        try {
            const result = detectConanfiles(tempDir);
            
            assert.strictEqual(result.hasPyFile, true);
            assert.strictEqual(result.hasTxtFile, true);
            assert.strictEqual(result.hasAnyConanfile, true);
            assert.strictEqual(result.preferredFile, 'conanfile.py');
            assert.strictEqual(result.preferredPath, pyPath);
        } finally {
            vscode.workspace.getConfiguration = originalGetConfiguration;
        }
    });

    test('detectConanfiles - both files, prefer txt', async () => {
        const pyPath = path.join(tempDir, 'conanfile.py');
        const txtPath = path.join(tempDir, 'conanfile.txt');
        
        fs.writeFileSync(pyPath, 'from conan import ConanFile\\n\\nclass TestConan(ConanFile):\\n    pass');
        fs.writeFileSync(txtPath, '[requires]\\nzlib/1.2.11\\n[generators]\\nCMakeDeps\\nCMakeToolchain');
        
        // Mock configuration to return txt preference
        const mockConfig = {
            get: (key: string, defaultValue?: any) => {
                if (key === 'preferredConanfileFormat') {
                    return 'txt';
                }
                return defaultValue;
            }
        } as any;
        
        // Override workspace configuration temporarily
        const originalGetConfiguration = vscode.workspace.getConfiguration;
        vscode.workspace.getConfiguration = () => mockConfig;
        
        try {
            const result = detectConanfiles(tempDir);
            
            assert.strictEqual(result.hasPyFile, true);
            assert.strictEqual(result.hasTxtFile, true);
            assert.strictEqual(result.hasAnyConanfile, true);
            assert.strictEqual(result.preferredFile, 'conanfile.txt');
            assert.strictEqual(result.preferredPath, txtPath);
        } finally {
            vscode.workspace.getConfiguration = originalGetConfiguration;
        }
    });

    test('getConanfileWatchPattern', () => {
        const pattern = getConanfileWatchPattern(tempDir);
        const expectedPattern = path.join(tempDir, 'conanfile.{py,txt}');
        
        assert.strictEqual(pattern, expectedPattern);
    });

    test('isConanfileChange - conanfile.py', () => {
        const pyPath = path.join(tempDir, 'conanfile.py');
        assert.strictEqual(isConanfileChange(pyPath), true);
    });

    test('isConanfileChange - conanfile.txt', () => {
        const txtPath = path.join(tempDir, 'conanfile.txt');
        assert.strictEqual(isConanfileChange(txtPath), true);
    });

    test('isConanfileChange - other file', () => {
        const otherPath = path.join(tempDir, 'CMakeLists.txt');
        assert.strictEqual(isConanfileChange(otherPath), false);
    });

    test('isConanfileChange - similar name but not conanfile', () => {
        const similarPath = path.join(tempDir, 'myconanfile.py');
        assert.strictEqual(isConanfileChange(similarPath), false);
    });
});

suite('Conanfile Watcher Integration Tests', () => {
    let tempDir: string;
    let testWorkspace: vscode.WorkspaceFolder;

    setup(async () => {
        // Create a temporary directory for integration tests
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conan-watcher-test-'));
        
        // Create a mock workspace folder
        testWorkspace = {
            uri: vscode.Uri.file(tempDir),
            name: path.basename(tempDir),
            index: 0
        };
    });

    teardown(async () => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('file watcher pattern covers both conanfile types', () => {
        const pattern = getConanfileWatchPattern(tempDir);
        
        // The pattern should be able to match both .py and .txt files
        const pyFile = path.join(tempDir, 'conanfile.py');
        const txtFile = path.join(tempDir, 'conanfile.txt');
        
        // Note: We can't easily test the actual glob matching without setting up
        // a full VS Code workspace, but we can verify the pattern format
        assert.ok(pattern.includes('conanfile.{py,txt}'));
        assert.ok(pattern.includes(tempDir));
    });

    test('conanfile creation scenario', async () => {
        // Initially no conanfiles
        let result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, false);
        
        // Create conanfile.py
        const pyPath = path.join(tempDir, 'conanfile.py');
        fs.writeFileSync(pyPath, 'from conan import ConanFile\\n\\nclass TestConan(ConanFile):\\n    pass');
        
        // Should now detect the file
        result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, true);
        assert.strictEqual(result.preferredFile, 'conanfile.py');
    });

    test('conanfile deletion scenario', async () => {
        // Create initial conanfile
        const pyPath = path.join(tempDir, 'conanfile.py');
        fs.writeFileSync(pyPath, 'from conan import ConanFile\\n\\nclass TestConan(ConanFile):\\n    pass');
        
        // Verify it's detected
        let result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, true);
        
        // Delete the file
        fs.unlinkSync(pyPath);
        
        // Should no longer be detected
        result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, false);
    });

    test('multiple conanfiles creation and preference change', async () => {
        // Mock configuration to prefer py initially
        const mockConfig = {
            get: (key: string, defaultValue?: any) => {
                if (key === 'preferredConanfileFormat') {
                    return 'py';
                }
                return defaultValue;
            }
        } as any;
        
        const originalGetConfiguration = vscode.workspace.getConfiguration;
        vscode.workspace.getConfiguration = () => mockConfig;
        
        try {
            // Create both files
            const pyPath = path.join(tempDir, 'conanfile.py');
            const txtPath = path.join(tempDir, 'conanfile.txt');
            
            fs.writeFileSync(pyPath, 'from conan import ConanFile\\n\\nclass TestConan(ConanFile):\\n    pass');
            fs.writeFileSync(txtPath, '[requires]\\nzlib/1.2.11');
            
            // Should prefer .py
            let result = detectConanfiles(tempDir);
            assert.strictEqual(result.preferredFile, 'conanfile.py');
            
            // Change preference to txt
            mockConfig.get = (key: string, defaultValue?: any) => {
                if (key === 'preferredConanfileFormat') {
                    return 'txt';
                }
                return defaultValue;
            };
            
            // Should now prefer .txt
            result = detectConanfiles(tempDir);
            assert.strictEqual(result.preferredFile, 'conanfile.txt');
            
        } finally {
            vscode.workspace.getConfiguration = originalGetConfiguration;
        }
    });

    test('conanfile modification maintains detection', async () => {
        const pyPath = path.join(tempDir, 'conanfile.py');
        fs.writeFileSync(pyPath, 'from conan import ConanFile\\n\\nclass TestConan(ConanFile):\\n    pass');
        
        // Verify initial detection
        let result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, true);
        assert.strictEqual(result.preferredFile, 'conanfile.py');
        
        // Modify the file
        fs.writeFileSync(pyPath, 'from conan import ConanFile\\n\\nclass TestConan(ConanFile):\\n    requires = "zlib/1.2.11"');
        
        // Should still be detected with same preference
        result = detectConanfiles(tempDir);
        assert.strictEqual(result.hasAnyConanfile, true);
        assert.strictEqual(result.preferredFile, 'conanfile.py');
    });
});