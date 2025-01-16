import * as vscode from 'vscode';
import { SnippetTreeDataProvider } from './sidebar/SnippetTreeDataProvider';
import { LocalStorage } from './storage/LocalStorage';
import { GistStorage } from './storage/GistStorage';
import { SnippetEditor } from './editor/SnippetEditor';
import { BackupManager } from './backup/BackupManager';
import * as fs from 'fs';
import * as path from 'path';
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

        vscode.commands.registerCommand('snippets.deleteItem', async (item) => {
            if (item.type === 'folder') {
                const answer = await vscode.window.showWarningMessage(
                    `Are you sure you want to delete the folder "${item.label}" and all its snippets? This action cannot be undone.`,
                    'Yes', 'No'
                );
                
                if (answer !== 'Yes') {
                    return;
                }
                await localStorage.deleteFolder(item.id);
            } else {
                const answer = await vscode.window.showWarningMessage(
                    `Are you sure you want to delete the snippet "${item.label}"?`,
                    'Yes', 'No'
                );
                
                if (answer !== 'Yes') {
                    return;
                }
                await localStorage.deleteSnippet(item.id);
                // Also delete the gist if it exists
                try {
                    await gistStorage.deleteSnippetGist(item.id);
                } catch (error) {
                    // Log but don't show error to user since the local delete succeeded
                    console.error('Error deleting gist:', error);
                }
            }
            treeDataProvider.refresh();
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

        vscode.commands.registerCommand('snippets.syncToGist', async () => {
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
                    title: "Syncing snippets to GitHub Gist...",
                    cancellable: false
                }, async () => {
                    const data = await localStorage.getAllData();
                    await gistStorage.sync(data);
                });
                
                const gistId = await config.get('gistId');
                vscode.window.showInformationMessage(
                    `Successfully synced to GitHub Gist${gistId ? ` (ID: ${gistId})` : ''}`,
                    'Open in Browser'
                ).then(selection => {
                    if (selection === 'Open in Browser' && gistId) {
                        vscode.env.openExternal(vscode.Uri.parse(`https://gist.github.com/${gistId}`));
                    }
                });
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to sync to GitHub Gist: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('snippets.syncFromGist', async () => {
            try {
                const data = await gistStorage.load();
                if (data) {
                    await localStorage.syncData(data);
                    treeDataProvider.refresh();
                    vscode.window.showInformationMessage('Successfully synced from GitHub Gist');
                }
            } catch (error) {
                vscode.window.showErrorMessage('Failed to sync from GitHub Gist');
            }
        }),

        vscode.commands.registerCommand('snippets.renameFolder', async (item) => {
            const newName = await vscode.window.showInputBox({
                prompt: 'Enter new folder name',
                value: item.label
            });
            
            if (newName) {
                await localStorage.renameFolder(item.id, newName);
                treeDataProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('snippets.renameSnippet', async (item) => {
            const newName = await vscode.window.showInputBox({
                prompt: 'Enter new snippet name',
                value: item.label
            });
            
            if (newName) {
                await localStorage.renameSnippet(item.id, newName);
                treeDataProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('snippets.exportSnippets', async () => {
            try {
                const data = await localStorage.getAllData();
                
                // Show save dialog
                const defaultPath = path.join(vscode.workspace.rootPath || '', 'snippets-export.json');
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(defaultPath),
                    filters: {
                        'JSON files': ['json']
                    }
                });

                if (uri) {
                    // Write the file
                    const jsonString = JSON.stringify(data, null, 2);
                    await fs.promises.writeFile(uri.fsPath, jsonString);
                    
                    vscode.window.showInformationMessage(
                        'Successfully exported snippets',
                        'Open File'
                    ).then(selection => {
                        if (selection === 'Open File') {
                            vscode.workspace.openTextDocument(uri).then(doc => {
                                vscode.window.showTextDocument(doc);
                            });
                        }
                    });
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to export snippets: ${error.message}`);
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
        })
    );

    console.log('Extension activated');  // Debug log
} 