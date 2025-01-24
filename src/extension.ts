import * as vscode from 'vscode';
import { LocalStorage } from './storage/LocalStorage';
import { GistStorage } from './storage/GistStorage';
import { SnippetEditor } from './editor/SnippetEditor';
import * as fs from 'fs';
import { SnippetTreeItem } from './sidebar/SnippetTreeItem';
import { SnippetTreeDataProvider } from './sidebar/SnippetTreeDataProvider';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const localStorage = new LocalStorage();
    const gistStorage = new GistStorage(localStorage);
    const treeDataProvider = new SnippetTreeDataProvider(localStorage);

    // Check for auto-sync on startup
    const config = vscode.workspace.getConfiguration('snippets');
    if (config.get<boolean>('autoSyncOnStartup')) {
        syncFromBackupFolder(localStorage, treeDataProvider).catch(error => {
            console.error('Auto-sync failed:', error);
        });
    }

    // Register views
    const treeView = vscode.window.createTreeView('snippetsExplorer', {
        treeDataProvider,
        showCollapseAll: false,
        dragAndDropController: {
            dropMimeTypes: ['application/vnd.code.tree.snippetsExplorer'],
            dragMimeTypes: ['application/vnd.code.tree.snippetsExplorer'],
            handleDrag: (source: readonly vscode.TreeItem[], treeDataTransfer: vscode.DataTransfer) => {
                return treeDataProvider.handleDrag(source as SnippetTreeItem[], treeDataTransfer);
            },
            handleDrop: async (target: vscode.TreeItem, sources: vscode.DataTransfer) => {
                return treeDataProvider.handleDrop(target as SnippetTreeItem, sources);
            }
        }
    });

    // Register commands
    const disposables = [
        vscode.commands.registerCommand('snippets.manageSettings', async () => {
            const items = [
                { label: 'Configure GitHub Token', command: 'snippets.manageGitHubToken' },
                { label: 'Push to GitHub Gist', command: 'snippets.pushToGist' },
                { label: 'Pull from GitHub Gist', command: 'snippets.pullFromGist' },
                { label: 'Configure Backup Folder', command: 'snippets.configureBackupFolder' },
                { label: 'Sync from Backup Folder', command: 'snippets.syncFromBackupFolder' },
                { label: 'Import Snippets', command: 'snippets.importSnippets' },
                { label: 'Export Snippets', command: 'snippets.exportSnippets' },
                { label: 'Reset GitHub Configuration', command: 'snippets.resetGithubConfig' }
            ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a settings option'
            });

            if (selected) {
                await vscode.commands.executeCommand(selected.command);
            }
        }),

        vscode.commands.registerCommand('snippets.renameFolder', async (item: SnippetTreeItem) => {
            const newName = await vscode.window.showInputBox({
                prompt: 'Enter new folder name',
                placeHolder: item.label as string,
                value: item.label as string
            });

            if (newName) {
                try {
                    await localStorage.renameFolder(item.id, newName);
                    treeDataProvider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage('Failed to rename folder: ' + error);
                }
            }
        }),

        vscode.commands.registerCommand('snippets.renameSnippet', async (item: SnippetTreeItem) => {
            const newName = await vscode.window.showInputBox({
                prompt: 'Enter new snippet name',
                placeHolder: item.label as string,
                value: item.label as string
            });

            if (newName) {
                try {
                    await localStorage.renameSnippet(item.id, newName);
                    treeDataProvider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage('Failed to rename snippet: ' + error);
                }
            }
        }),

        vscode.commands.registerCommand('snippets.updateSnippet', async (update: {
            id: string;
            code?: string;
            notes?: string;
            language?: string;
            tags?: string[];
        }) => {
            try {
                await localStorage.updateSnippet(update);
                treeDataProvider.refresh();
            } catch (error) {
                throw new Error('Failed to update snippet: ' + error);
            }
        }),

        vscode.commands.registerCommand('snippets.openSnippet', async (snippetInfo: { id: string; name: string; language?: string }) => {
            try {
                const snippet = await localStorage.getSnippet(snippetInfo.id);
                if (snippet) {
                    await SnippetEditor.show(snippet);
                } else {
                    vscode.window.showErrorMessage('Snippet not found');
                }
            } catch (error) {
                vscode.window.showErrorMessage('Failed to open snippet: ' + error);
            }
        }),

        vscode.commands.registerCommand('snippets.addFolder', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Enter folder name',
                placeHolder: 'My Folder'
            });
            if (name) {
                try {
                    await localStorage.addFolder(name, null, 'primary' as const);
                    treeDataProvider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage('Failed to create folder: ' + error);
                }
            }
        }),

        vscode.commands.registerCommand('snippets.addSubfolder', async (parentItem: SnippetTreeItem) => {
            const name = await vscode.window.showInputBox({
                prompt: 'Enter subfolder name',
                placeHolder: 'My Subfolder'
            });
            if (name) {
                try {
                    const folder = await localStorage.addFolder(name, parentItem.id, 'primary' as const);
                    treeDataProvider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage('Failed to create subfolder: ' + error);
                }
            }
        }),

        vscode.commands.registerCommand('snippets.addSnippet', async (parentItem?: SnippetTreeItem) => {
            if (!parentItem) {
                vscode.window.showErrorMessage('Please select a folder first');
                return;
            }
            const name = await vscode.window.showInputBox({
                prompt: 'Enter snippet name',
                placeHolder: 'My Snippet'
            });
            if (name) {
                try {
                    await localStorage.addSnippet({
                        name,
                        folderId: parentItem.id,
                        code: '',
                        language: 'plaintext',
                        notes: ''
                    });
                    treeDataProvider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage('Failed to create snippet: ' + error);
                }
            }
        }),

        vscode.commands.registerCommand('snippets.deleteItem', async (item: SnippetTreeItem) => {
            if (!item) {
                return;
            }

            const confirmMessage = item.type === 'folder' 
                ? 'Are you sure you want to delete this folder and all its snippets?' 
                : 'Are you sure you want to delete this snippet?';

            const confirmed = await vscode.window.showWarningMessage(
                confirmMessage,
                { modal: true },
                'Delete'
            );

            if (confirmed === 'Delete') {
                try {
                    if (item.type === 'folder') {
                        await localStorage.deleteFolder(item.id);
                    } else {
                        await localStorage.deleteSnippet(item.id);
                    }
                    treeDataProvider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage('Failed to delete item: ' + (error as Error).message);
                }
            }
        }),

        vscode.commands.registerCommand('snippets.manageGitHubToken', async () => {
            const token = await vscode.window.showInputBox({
                prompt: 'Enter your GitHub Personal Access Token',
                password: true,
                placeHolder: 'ghp_...',
                ignoreFocusOut: true
            });

            if (token) {
                try {
                    await vscode.workspace.getConfiguration('snippets').update('githubToken', token, true);
                    vscode.window.showInformationMessage('GitHub token saved successfully');
                } catch (error) {
                    vscode.window.showErrorMessage('Failed to save GitHub token: ' + error);
                }
            }
        }),

        vscode.commands.registerCommand('snippets.resetGithubConfig', async () => {
            try {
                const config = vscode.workspace.getConfiguration('snippets');
                await config.update('githubToken', undefined, true);
                await config.update('gistMapping', {}, true);
                vscode.window.showInformationMessage('GitHub configuration has been reset');
            } catch (error) {
                vscode.window.showErrorMessage('Failed to reset GitHub configuration: ' + error);
            }
        }),

        vscode.commands.registerCommand('snippets.configureBackupFolder', async () => {
            const currentFolder = vscode.workspace.getConfiguration('snippets').get<string>('backupFolder');
            
            const options: vscode.OpenDialogOptions = {
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                defaultUri: currentFolder ? vscode.Uri.file(currentFolder) : undefined,
                openLabel: 'Select Backup Folder'
            };

            const result = await vscode.window.showOpenDialog(options);
            if (result && result[0]) {
                try {
                    await vscode.workspace.getConfiguration('snippets').update('backupFolder', result[0].fsPath, true);
                    vscode.window.showInformationMessage('Backup folder configured successfully');
                } catch (error) {
                    vscode.window.showErrorMessage('Failed to configure backup folder: ' + error);
                }
            }
        }),

        vscode.commands.registerCommand('snippets.importSnippets', async () => {
            const options: vscode.OpenDialogOptions = {
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'JSON files': ['json']
                },
                openLabel: 'Import Snippets'
            };

            const result = await vscode.window.showOpenDialog(options);
            if (result && result[0]) {
                try {
                    const content = await fs.promises.readFile(result[0].fsPath, 'utf8');
                    const data = JSON.parse(content);

                    console.log('[DEBUG] Import - Parsed file content:', data);

                    let folders: any[] = [];
                    let snippets: any[] = [];

                    // Handle array format (exported format)
                    if (Array.isArray(data)) {
                        data.forEach(item => {
                            if (item.type === 'folder') {
                                // Remove the type field as it's not needed in storage
                                const { type, ...folderData } = item;
                                folders.push(folderData);
                            } else if (item.folderId) {
                                snippets.push(item);
                            }
                        });
                    }

                    console.log('[DEBUG] Import - Processed data:', {
                        folders: folders.length,
                        snippets: snippets.length
                    });

                    // Get current data
                    const currentData = await localStorage.getAllData();

                    // Merge the data
                    const mergedFolders = mergeFolders(currentData.folders, folders);
                    const mergedSnippets = mergeSnippets(currentData.snippets, snippets);

                    console.log('[DEBUG] Import - Final data:', {
                        folders: mergedFolders.length,
                        snippets: mergedSnippets.length
                    });

                    // Sync the merged data
                    await localStorage.syncData({
                        folders: mergedFolders,
                        snippets: mergedSnippets
                    });

                    treeDataProvider.refresh();
                    vscode.window.showInformationMessage('Snippets imported successfully');
                } catch (error) {
                    console.error('[DEBUG] Import error:', error);
                    vscode.window.showErrorMessage('Failed to import snippets: ' + error);
                }
            }
        }),

        vscode.commands.registerCommand('snippets.exportSnippets', async () => {
            const options: vscode.SaveDialogOptions = {
                defaultUri: vscode.Uri.file('snippets_export.json'),
                filters: {
                    'JSON files': ['json']
                },
                saveLabel: 'Export Snippets'
            };

            const result = await vscode.window.showSaveDialog(options);
            if (result) {
                try {
                    const data = await localStorage.getAllData();
                    // Convert folders to have type='folder'
                    const folders = data.folders.map(folder => ({
                        ...folder,
                        type: 'folder'
                    }));
                    // Combine folders and snippets into a single array
                    const combinedData = [...folders, ...data.snippets];
                    await fs.promises.writeFile(result.fsPath, JSON.stringify(combinedData, null, 2));
                    vscode.window.showInformationMessage('Snippets exported successfully');
                } catch (error) {
                    vscode.window.showErrorMessage('Failed to export snippets: ' + error);
                }
            }
        }),

        vscode.commands.registerCommand('snippets.pushToGist', async () => {
            try {
                const token = vscode.workspace.getConfiguration('snippets').get<string>('githubToken');
                if (!token) {
                    const result = await vscode.window.showWarningMessage(
                        'GitHub token not configured. Would you like to configure it now?',
                        'Yes',
                        'No'
                    );
                    if (result === 'Yes') {
                        await vscode.commands.executeCommand('snippets.manageGitHubToken');
                        return;
                    }
                    return;
                }

                await gistStorage.syncToGist();
                vscode.window.showInformationMessage('Successfully pushed snippets to GitHub Gist');
            } catch (error) {
                vscode.window.showErrorMessage('Failed to push to GitHub Gist: ' + error);
            }
        }),

        vscode.commands.registerCommand('snippets.pullFromGist', async () => {
            try {
                const token = vscode.workspace.getConfiguration('snippets').get<string>('githubToken');
                if (!token) {
                    const result = await vscode.window.showWarningMessage(
                        'GitHub token not configured. Would you like to configure it now?',
                        'Yes',
                        'No'
                    );
                    if (result === 'Yes') {
                        await vscode.commands.executeCommand('snippets.manageGitHubToken');
                        return;
                    }
                    return;
                }

                await gistStorage.syncFromGist();
                treeDataProvider.refresh();
                vscode.window.showInformationMessage('Successfully pulled snippets from GitHub Gist');
            } catch (error) {
                vscode.window.showErrorMessage('Failed to pull from GitHub Gist: ' + error);
            }
        }),

        vscode.commands.registerCommand('snippets.search', async () => {
            const searchQuery = await vscode.window.showInputBox({
                placeHolder: 'Search snippets...',
                prompt: 'Enter search term to filter snippets'
            });

            if (searchQuery !== undefined) {
                treeDataProvider.setSearchQuery(searchQuery);
            }
        }),

        vscode.commands.registerCommand('snippets.clearSearch', () => {
            treeDataProvider.clearSearch();
        }),

        vscode.commands.registerCommand('snippets.syncFromBackupFolder', async () => {
            await syncFromBackupFolder(localStorage, treeDataProvider);
        }),

        treeView
    ];

    context.subscriptions.push(...disposables);
}

async function syncFromBackupFolder(localStorage: LocalStorage, treeDataProvider: SnippetTreeDataProvider): Promise<void> {
    try {
        const backupFolder = vscode.workspace.getConfiguration('snippets').get<string>('backupFolder');
        console.log('[DEBUG] Attempting to sync from backup folder:', backupFolder);
        
        if (!backupFolder) {
            const result = await vscode.window.showWarningMessage(
                'Backup folder not configured. Would you like to configure it now?',
                'Yes',
                'No'
            );
            if (result === 'Yes') {
                await vscode.commands.executeCommand('snippets.configureBackupFolder');
                return;
            }
            return;
        }

        // Let user select the JSON file to sync from
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: vscode.Uri.file(backupFolder),
            filters: {
                'JSON files': ['json']
            },
            title: 'Select JSON file to sync from'
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        if (!fileUri || fileUri.length === 0) {
            return;
        }

        const filePath = fileUri[0].fsPath;
        console.log('[DEBUG] Selected file:', filePath);

        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            const data = JSON.parse(content);

            console.log('[DEBUG] Parsed file content:', data);

            let folders: any[] = [];
            let snippets: any[] = [];

            // Handle different possible formats
            if (Array.isArray(data)) {
                // Process each item in the array
                data.forEach(item => {
                    if (item.type === 'folder') {
                        folders.push(item);
                    } else if (item.folderId) {
                        snippets.push(item);
                    }
                });
            } else if (typeof data === 'object') {
                // If it's an object with folders and snippets
                if (data.folders) {
                    folders = Array.isArray(data.folders) ? data.folders : [];
                }
                if (data.snippets) {
                    snippets = Array.isArray(data.snippets) ? data.snippets : [];
                }
            }

            console.log('[DEBUG] Processed data:', {
                folders: folders.length,
                snippets: snippets.length
            });

            // Get current data
            const currentData = await localStorage.getAllData();

            // Merge the data
            const mergedFolders = mergeFolders(currentData.folders, folders);
            const mergedSnippets = mergeSnippets(currentData.snippets, snippets);

            console.log('[DEBUG] Merged data:', {
                folders: mergedFolders.length,
                snippets: mergedSnippets.length
            });

            // Sync the merged data
            await localStorage.syncData({
                folders: mergedFolders,
                snippets: mergedSnippets
            });
            
            treeDataProvider.refresh();
            vscode.window.showInformationMessage('Successfully synced snippets from selected file');
        } catch (error) {
            console.error('[DEBUG] Error reading/parsing file:', error);
            vscode.window.showErrorMessage('Failed to read or parse the selected file');
            return;
        }
    } catch (error) {
        console.error('[DEBUG] Sync error:', error);
        vscode.window.showErrorMessage('Failed to sync from backup folder: ' + error);
    }
}

// Helper function to merge folders arrays while preserving unique IDs
function mergeFolders(existing: any[], newFolders: any[]): any[] {
    const folderMap = new Map();
    
    // Add existing folders to map
    existing.forEach(folder => {
        folderMap.set(folder.id, folder);
    });

    // Merge in new folders, preserving existing ones
    newFolders.forEach(folder => {
        if (!folderMap.has(folder.id)) {
            folderMap.set(folder.id, folder);
        }
    });

    return Array.from(folderMap.values());
}

// Helper function to merge snippets arrays while preserving unique IDs
function mergeSnippets(existing: any[], newSnippets: any[]): any[] {
    const snippetMap = new Map();
    
    // Add existing snippets to map
    existing.forEach(snippet => {
        snippetMap.set(snippet.id, snippet);
    });

    // Merge in new snippets, preserving existing ones
    newSnippets.forEach(snippet => {
        if (!snippetMap.has(snippet.id)) {
            snippetMap.set(snippet.id, snippet);
        }
    });

    return Array.from(snippetMap.values());
} 