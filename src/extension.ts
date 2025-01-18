import * as vscode from 'vscode';
import { SnippetTreeDataProvider } from './sidebar/SnippetTreeDataProvider';
import { LocalStorage } from './storage/LocalStorage';
import { GistStorage } from './storage/GistStorage';
import { SnippetEditor } from './editor/SnippetEditor';
import { BackupManager } from './backup/BackupManager';
import * as fs from 'fs';
import { SnippetTreeItem } from './sidebar/SnippetTreeItem';

export function activate(context: vscode.ExtensionContext) {
    console.log('Activating extension');  // Debug log
    
    const localStorage = new LocalStorage(context.globalState);
    const gistStorage = new GistStorage();
    const treeDataProvider = new SnippetTreeDataProvider(localStorage, gistStorage);

    vscode.window.registerTreeDataProvider('snippetsExplorer', treeDataProvider);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('snippets.addFolder', async () => {
            const folderName = await vscode.window.showInputBox({
                placeHolder: 'Enter folder name'
            });
            if (folderName) {
                await localStorage.addFolder(folderName);
                treeDataProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('snippets.addSnippet', async (folder) => {
            const snippetName = await vscode.window.showInputBox({
                placeHolder: 'Enter snippet name'
            });
            if (snippetName) {
                const snippet = {
                    name: snippetName,
                    code: '',
                    notes: '',
                    folderId: folder.id,
                    language: 'plaintext'
                };
                await localStorage.addSnippet(snippet);
                treeDataProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('snippets.deleteItem', async (item: SnippetTreeItem) => {
            try {
                console.log('Delete command triggered for:', item);
                if (!item) {
                    console.error('No item provided to delete command');
                    return;
                }

                if (item.type === 'folder') {
                    const answer = await vscode.window.showWarningMessage(
                        `Are you sure you want to delete the folder "${item.label}" and all its snippets? This action cannot be undone.`,
                        { modal: true },
                        'Yes', 'No'
                    );
                    
                    if (answer !== 'Yes') {
                        return;
                    }

                    console.log('Deleting folder:', item.id);
                    await localStorage.deleteFolder(item.id);
                    console.log('Folder deletion successful');
                } else {
                    const answer = await vscode.window.showWarningMessage(
                        `Are you sure you want to delete the snippet "${item.label}"?`,
                        { modal: true },
                        'Yes', 'No'
                    );
                    
                    if (answer !== 'Yes') {
                        return;
                    }

                    console.log('Deleting snippet:', item.id);
                    await localStorage.deleteSnippet(item.id);
                    console.log('Local deletion successful');

                    // Also delete the gist if it exists
                    try {
                        await gistStorage.deleteSnippetGist(item.id);
                        console.log('Gist deletion successful');
                    } catch (error) {
                        // Log but don't show error to user since the local delete succeeded
                        console.error('Error deleting gist:', error);
                    }
                }
                
                console.log('Refreshing tree view');
                treeDataProvider.refresh();
            } catch (error) {
                console.error('Error in delete command:', error);
                vscode.window.showErrorMessage('Failed to delete item: ' + (error as Error).message);
            }
        }),

        vscode.commands.registerCommand('snippets.openSnippet', async (item: SnippetTreeItem) => {
            const snippet = await localStorage.getSnippet(item.id);
            if (snippet) {
                await SnippetEditor.show(snippet);
            } else {
                vscode.window.showErrorMessage('Snippet not found');
            }
        }),

        vscode.commands.registerCommand('snippets.configureSync', async () => {
            await gistStorage.configure();
        }),

        vscode.commands.registerCommand('snippets.pushToGist', async () => {
            try {
                // Check if GitHub sync is configured
                const config = vscode.workspace.getConfiguration('snippets');
                const token = await config.get('githubToken');
                if (!token) {
                    const configure = 'Configure GitHub Sync';
                    const response = await vscode.window.showWarningMessage(
                        'GitHub sync is not configured. Would you like to configure it now?',
                        configure
                    );
                    if (response === configure) {
                        await gistStorage.configure();
                        return;
                    }
                    return;
                }

                // Show progress notification
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Pushing snippets to GitHub Gist...",
                    cancellable: false
                }, async () => {
                    const data = await localStorage.getAllData();
                    await gistStorage.sync(data);
                });
                
                const gistId = await config.get('gistId');
                vscode.window.showInformationMessage(
                    `Successfully pushed to GitHub Gist${gistId ? ` (ID: ${gistId})` : ''}`,
                    'Open in Browser'
                ).then(selection => {
                    if (selection === 'Open in Browser' && gistId) {
                        vscode.env.openExternal(vscode.Uri.parse(`https://gist.github.com/${gistId}`));
                    }
                });
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to push to GitHub Gist: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('snippets.pullFromGist', async () => {
            try {
                // Check if GitHub sync is configured
                const config = vscode.workspace.getConfiguration('snippets');
                const token = await config.get('githubToken');
                if (!token) {
                    const configure = 'Configure GitHub Sync';
                    const response = await vscode.window.showWarningMessage(
                        'GitHub sync is not configured. Would you like to configure it now?',
                        configure
                    );
                    if (response === configure) {
                        await gistStorage.configure();
                        return;
                    }
                    return;
                }

                // Show progress notification
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Pulling snippets from GitHub Gist...",
                    cancellable: false
                }, async () => {
                    const data = await gistStorage.load();
                    if (data) {
                        await localStorage.syncData(data);
                        treeDataProvider.refresh();
                    }
                });
                
                vscode.window.showInformationMessage('Successfully pulled snippets from GitHub Gist');
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to pull from GitHub Gist: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('snippets.manageGitHubToken', async () => {
            const config = vscode.workspace.getConfiguration('snippets');
            const currentToken = await config.get('snippets.githubToken');
            
            const items: vscode.QuickPickItem[] = [
                {
                    label: "$(key) Update GitHub Token",
                    description: "Change your GitHub Personal Access Token"
                },
                {
                    label: "$(sync) Test Connection",
                    description: "Verify your current GitHub token"
                },
                {
                    label: "$(trash) Remove Token",
                    description: "Delete the stored GitHub token"
                }
            ];

            if (!currentToken) {
                items.unshift({
                    label: "$(add) Configure GitHub Token",
                    description: "Set up GitHub synchronization"
                });
            }

            const selection = await vscode.window.showQuickPick(items, {
                placeHolder: 'Manage GitHub Token'
            });

            if (!selection) {
                return;
            }

            switch (selection.label) {
                case "$(add) Configure GitHub Token":
                case "$(key) Update GitHub Token":
                    await gistStorage.configure();
                    break;
                    
                case "$(sync) Test Connection":
                    try {
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: "Testing GitHub connection...",
                            cancellable: false
                        }, async () => {
                            await gistStorage.testConnection();
                        });
                        vscode.window.showInformationMessage('GitHub connection successful!');
                    } catch (error: any) {
                        vscode.window.showErrorMessage(`GitHub connection failed: ${error.message}`);
                    }
                    break;
                    
                case "$(trash) Remove Token":
                    const confirm = await vscode.window.showWarningMessage(
                        'Are you sure you want to remove your GitHub token? This will disable synchronization.',
                        'Yes', 'No'
                    );
                    if (confirm === 'Yes') {
                        await vscode.workspace.getConfiguration().update('snippets.githubToken', undefined, true);
                        await vscode.workspace.getConfiguration().update('snippets.lastGistId', undefined, true);
                        vscode.window.showInformationMessage('GitHub token has been removed');
                    }
                    break;
            }
        }),

        vscode.commands.registerCommand('snippets.resetGithubConfig', async () => {
            try {
                await vscode.workspace.getConfiguration().update('snippets.githubToken', undefined, true);
                await vscode.workspace.getConfiguration().update('snippets.lastGistId', undefined, true);
                vscode.window.showInformationMessage('GitHub configuration has been reset. Please configure sync again.');
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to reset configuration: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('snippets.search', async () => {
            const query = await vscode.window.showInputBox({
                placeHolder: 'Search snippets by name or tag...',
                prompt: 'Enter text to search snippets'
            });
            
            if (query !== undefined) { // User didn't cancel
                treeDataProvider.setSearchQuery(query);
            }
        }),

        vscode.commands.registerCommand('snippets.clearSearch', () => {
            treeDataProvider.setSearchQuery('');
        }),

        vscode.commands.registerCommand('snippets.manageSettings', async () => {
            const items: vscode.QuickPickItem[] = [
                {
                    label: "$(import) Import Snippets",
                    description: "Import snippets from a JSON file",
                    detail: "Import your snippets from a backup file"
                },
                {
                    label: "$(export) Export Snippets",
                    description: "Export snippets to a JSON file",
                    detail: "Backup your snippets to a file"
                },
                {
                    label: "$(cloud-upload) Push to GitHub Gist",
                    description: "Upload your snippets to GitHub Gist",
                    detail: "Sync your snippets to GitHub"
                },
                {
                    label: "$(cloud-download) Pull from GitHub Gist",
                    description: "Download snippets from GitHub Gist",
                    detail: "Get your snippets from GitHub"
                },
                {
                    label: "$(key) Manage GitHub Token",
                    description: "Configure GitHub authentication",
                    detail: "Set up or update your GitHub access"
                },
                {
                    label: "$(sync-ignored) Reset GitHub Configuration",
                    description: "Clear GitHub settings",
                    detail: "Remove GitHub token and settings"
                },
                {
                    label: "$(folder) Configure Backup Folder",
                    description: "Set automatic backup location",
                    detail: "Choose where to save snippet backups"
                }
            ];

            const selection = await vscode.window.showQuickPick(items, {
                placeHolder: 'Snippets Manager Settings',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selection) {
                return;
            }

            switch (selection.label) {
                case "$(import) Import Snippets":
                    await vscode.commands.executeCommand('snippets.importSnippets');
                    break;
                case "$(export) Export Snippets":
                    await vscode.commands.executeCommand('snippets.exportSnippets');
                    break;
                case "$(cloud-upload) Push to GitHub Gist":
                    await vscode.commands.executeCommand('snippets.pushToGist');
                    break;
                case "$(cloud-download) Pull from GitHub Gist":
                    await vscode.commands.executeCommand('snippets.pullFromGist');
                    break;
                case "$(key) Manage GitHub Token":
                    await vscode.commands.executeCommand('snippets.manageGitHubToken');
                    break;
                case "$(sync-ignored) Reset GitHub Configuration":
                    await vscode.commands.executeCommand('snippets.resetGithubConfig');
                    break;
                case "$(folder) Configure Backup Folder":
                    await vscode.commands.executeCommand('snippets.configureBackupFolder');
                    break;
            }
        }),

        vscode.commands.registerCommand('snippets.updateSnippet', async (update: {
            id: string;
            code?: string;
            notes?: string;
            language?: string;
            tags?: string[];
        }) => {
            await localStorage.updateSnippet(update);
            // Get the full snippet to backup
            const snippet = await localStorage.getSnippet(update.id);
            if (snippet) {
                await BackupManager.backupSnippet(snippet);
            }
            treeDataProvider.refresh();
        }),

        vscode.commands.registerCommand('snippets.configureBackupFolder', async () => {
            await BackupManager.configureBackupFolder();
        }),

        vscode.commands.registerCommand('snippets.importSnippets', async () => {
            try {
                // Show file picker for JSON files
                const uris = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    filters: {
                        'JSON files': ['json']
                    },
                    title: 'Select Snippets File to Import'
                });

                if (uris && uris[0]) {
                    // Read the selected file
                    const fileContent = await fs.promises.readFile(uris[0].fsPath, 'utf8');
                    
                    // Import the data
                    await localStorage.importData(fileContent);
                    
                    // Refresh the tree view
                    treeDataProvider.refresh();
                    
                    vscode.window.showInformationMessage('Snippets imported successfully!');
                }
            } catch (error: any) {
                console.error('Import error:', error);
                vscode.window.showErrorMessage(`Failed to import snippets: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('snippets.exportSnippets', async () => {
            try {
                // Get the export data
                const exportData = await localStorage.exportData();
                
                // Show save file dialog
                const uri = await vscode.window.showSaveDialog({
                    filters: {
                        'JSON files': ['json']
                    },
                    title: 'Save Snippets',
                    saveLabel: 'Export Snippets'
                });

                if (uri) {
                    // Write the file
                    await fs.promises.writeFile(uri.fsPath, exportData);
                    vscode.window.showInformationMessage('Snippets exported successfully!');
                }
            } catch (error: any) {
                console.error('Export error:', error);
                vscode.window.showErrorMessage(`Failed to export snippets: ${error.message}`);
            }
        })
    );

    console.log('Extension activated');  // Debug log
} 