import * as vscode from 'vscode';
import { LocalStorage } from './storage/LocalStorage';
import { SnippetTreeDataProvider } from './sidebar/SnippetTreeDataProvider';
import { SnippetEditor } from './editor/SnippetEditor';
import * as fs from 'fs';
import { SnippetTreeItem } from './sidebar/SnippetTreeItem';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const localStorage = new LocalStorage();
    const treeDataProvider = new SnippetTreeDataProvider(localStorage);
    const snippetEditor = new SnippetEditor();

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

        vscode.commands.registerCommand('snippets.manageSettings', async () => {
            const items = [
                { label: 'Configure Backup Folder', command: 'snippets.configureBackupFolder' },
                { label: 'Sync from Backup Folder', command: 'snippets.syncFromBackup' },
                { label: 'Import Snippets', command: 'snippets.importSnippets' },
                { label: 'Export Snippets', command: 'snippets.exportSnippets' }
            ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select an action'
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
                    // Keep the original data structure, just add type to folders
                    const exportData = {
                        folders: data.folders.map(folder => ({
                            ...folder,
                            type: 'folder'
                        })),
                        snippets: data.snippets
                    };
                    await fs.promises.writeFile(result.fsPath, JSON.stringify(exportData, null, 2));
                    vscode.window.showInformationMessage('Snippets exported successfully');
                } catch (error) {
                    vscode.window.showErrorMessage('Failed to export snippets: ' + error);
                }
            }
        }),

        vscode.commands.registerCommand('snippets.syncFromBackup', async () => {
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
                    }
                    return;
                }

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

                // Read and parse the file
                const content = await fs.promises.readFile(filePath, 'utf8');
                console.log('[DEBUG] Raw file content:', content);
                
                const importedData = JSON.parse(content);
                console.log('[DEBUG] Parsed file content:', JSON.stringify(importedData, null, 2));

                let folders: any[] = [];
                let snippets: any[] = [];

                // Handle version 1.0 format (which is what we have in the backup)
                if (importedData.version === "1.0" && Array.isArray(importedData.data)) {
                    console.log('[DEBUG] Processing version 1.0 format');
                    importedData.data.forEach((item: any) => {
                        if (item.type === 'folder') {
                            // For folders, remove the type field but keep everything else
                            const { type, ...folderData } = item;
                            folders.push({
                                id: folderData.id,
                                name: folderData.name,
                                parentId: folderData.parentId,
                                lastModified: folderData.lastModified
                            });
                            console.log('[DEBUG] Added folder:', folderData);
                        } else {
                            // For snippets, keep all fields
                            snippets.push({
                                id: item.id,
                                name: item.name,
                                folderId: item.folderId,
                                code: item.code || '',
                                language: item.language || 'plaintext',
                                notes: item.notes || '',
                                tags: item.tags || [],
                                lastModified: item.lastModified
                            });
                            console.log('[DEBUG] Added snippet:', item);
                        }
                    });
                }

                console.log('[DEBUG] Processed data:', {
                    folders: folders.length,
                    snippets: snippets.length,
                    folderDetails: folders,
                    snippetDetails: snippets
                });

                if (folders.length === 0 && snippets.length === 0) {
                    vscode.window.showErrorMessage('No valid data found in the backup file');
                    return;
                }

                const confirmResult = await vscode.window.showInformationMessage(
                    `Found ${folders.length} folders and ${snippets.length} snippets. Do you want to sync with this data?`,
                    { modal: true },
                    'Sync',
                    'Cancel'
                );

                if (confirmResult === 'Sync') {
                    // Save the data directly
                    console.log('[DEBUG] Saving data to storage');
                    await localStorage.syncData({
                        folders: folders,
                        snippets: snippets
                    });

                    // Verify the save
                    const verifyData = await localStorage.getAllData();
                    console.log('[DEBUG] Verified saved data:', {
                        folders: verifyData.folders.length,
                        snippets: verifyData.snippets.length,
                        folderDetails: verifyData.folders,
                        snippetDetails: verifyData.snippets
                    });

                    // Force refresh
                    await treeDataProvider.refresh();
                    vscode.window.showInformationMessage('Successfully synced snippets from backup');
                }
            } catch (error) {
                console.error('[DEBUG] Sync error:', error);
                vscode.window.showErrorMessage('Failed to sync from backup: ' + error);
            }
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
            const importedData = JSON.parse(content);

            console.log('[DEBUG] Parsed file content:', importedData);

            let folders: any[] = [];
            let snippets: any[] = [];

            // Handle different possible formats
            if (importedData.version === "1.0" && Array.isArray(importedData.data)) {
                // Process each item in the array
                importedData.data.forEach((item: any) => {
                    if (item.type === 'folder') {
                        const { type, ...folderData } = item;
                        folders.push(folderData);
                    } else {
                        snippets.push(item);
                    }
                });
            } else if (Array.isArray(importedData)) {
                // Legacy format - direct array
                importedData.forEach((item: any) => {
                    if (item.type === 'folder') {
                        const { type, ...folderData } = item;
                        folders.push(folderData);
                    } else {
                        snippets.push(item);
                    }
                });
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

// Helper function to merge folders arrays while preserving unique IDs and using timestamps
function mergeFolders(existing: any[], newFolders: any[]): any[] {
    const folderMap = new Map();
    
    // Add existing folders to map
    existing.forEach(folder => {
        folderMap.set(folder.id, {
            ...folder,
            lastModified: folder.lastModified || Date.now() // Add timestamp if missing
        });
    });

    // Merge in new folders, using the most recent version
    newFolders.forEach(folder => {
        const existingFolder = folderMap.get(folder.id);
        const newFolder = {
            ...folder,
            lastModified: folder.lastModified || Date.now() // Add timestamp if missing
        };
        
        if (!existingFolder || (newFolder.lastModified > existingFolder.lastModified)) {
            folderMap.set(folder.id, newFolder);
        }
    });

    return Array.from(folderMap.values());
}

// Helper function to merge snippets arrays while preserving unique IDs and using timestamps
function mergeSnippets(existing: any[], newSnippets: any[]): any[] {
    const snippetMap = new Map();
    
    // Add existing snippets to map
    existing.forEach(snippet => {
        snippetMap.set(snippet.id, {
            ...snippet,
            lastModified: snippet.lastModified || Date.now() // Add timestamp if missing
        });
    });

    // Merge in new snippets, using the most recent version
    newSnippets.forEach(snippet => {
        const existingSnippet = snippetMap.get(snippet.id);
        const newSnippet = {
            ...snippet,
            lastModified: snippet.lastModified || Date.now() // Add timestamp if missing
        };
        
        if (!existingSnippet || (newSnippet.lastModified > existingSnippet.lastModified)) {
            snippetMap.set(snippet.id, newSnippet);
        }
    });

    return Array.from(snippetMap.values());
} 