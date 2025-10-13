import * as vscode from 'vscode';
import { ConanStore } from '../../conan_store';
import { ConanApiClient } from '../../conan_api_client';
import { getLogger } from '../../logger';

interface ConanTemplate {
    id: string;
    label: string;
    description: string;
}

// Available Conan templates based on conan new command documentation
const CONAN_TEMPLATES: ConanTemplate[] = [
    {
        id: 'cmake_lib',
        label: 'CMake Library',
        description: 'Create a CMake-based library with conanfile.py'
    },
    {
        id: 'cmake_exe',
        label: 'CMake Executable',
        description: 'Create a CMake-based executable with conanfile.py'
    },
    {
        id: 'meson_lib',
        label: 'Meson Library',
        description: 'Create a Meson-based library with conanfile.py'
    },
    {
        id: 'meson_exe',
        label: 'Meson Executable',
        description: 'Create a Meson-based executable with conanfile.py'
    },
    {
        id: 'bazel_lib',
        label: 'Bazel Library',
        description: 'Create a Bazel-based library with conanfile.py'
    },
    {
        id: 'bazel_exe',
        label: 'Bazel Executable',
        description: 'Create a Bazel-based executable with conanfile.py'
    },
    {
        id: 'autotools_lib',
        label: 'Autotools Library',
        description: 'Create an Autotools-based library with conanfile.py'
    },
    {
        id: 'autotools_exe',
        label: 'Autotools Executable',
        description: 'Create an Autotools-based executable with conanfile.py'
    },
    {
        id: 'msbuild_lib',
        label: 'MSBuild Library',
        description: 'Create an MSBuild-based library with conanfile.py'
    },
    {
        id: 'msbuild_exe',
        label: 'MSBuild Executable',
        description: 'Create an MSBuild-based executable with conanfile.py'
    }
];

export async function createConanfile(conanStore: ConanStore, apiClient: ConanApiClient): Promise<void> {
    const logger = getLogger();

    try {
        // Show template selection
        const templateItems = CONAN_TEMPLATES.map(template => ({
            label: template.label,
            description: template.description,
            template: template
        }));

        const selectedItem = await vscode.window.showQuickPick(templateItems, {
            placeHolder: 'Select a Conan project template',
            matchOnDescription: true
        });

        if (!selectedItem) {
            return; // User cancelled
        }

        const template = selectedItem.template;
        logger.info(`Selected template: ${template.id}`);

        // Prompt for project name (mandatory for all templates)
        const projectName = await vscode.window.showInputBox({
            prompt: 'Enter project name',
            placeHolder: 'my-project',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'Project name is required';
                }
                if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value.trim())) {
                    return 'Project name must start with a letter and contain only letters, numbers, hyphens, and underscores';
                }
                return undefined;
            }
        });

        // User cancelled the input or provided empty name
        if (!projectName || projectName.trim() === '') {
            return;
        }

        // Show progress while creating
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Creating Conan project with ${template.label} template...`,
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });

            try {
                await apiClient.createConanfile(conanStore.workspaceRoot, template.id, projectName.trim());
                
                progress.report({ increment: 100 });
                
                vscode.window.showInformationMessage(
                    `Conan project created successfully with ${template.label} template!`
                );

                logger.info(`Successfully created Conan project with template: ${template.id}`);
                
            } catch (error) {
                logger.error(`Failed to create Conan project: ${error}`);
                vscode.window.showErrorMessage(`Failed to create Conan project: ${error}`);
            }
        });

    } catch (error) {
        logger.error(`Error in createConanfile command: ${error}`);
        vscode.window.showErrorMessage(`Failed to create Conan project: ${error}`);
    }
}
