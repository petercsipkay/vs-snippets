import * as vscode from 'vscode';
import { LocalStorage } from './storage/LocalStorage';
import { SnippetTreeDataProvider } from './sidebar/SnippetTreeDataProvider';
import { SnippetEditor } from './editor/SnippetEditor';
import * as fs from 'fs';
import { SnippetTreeItem } from './sidebar/SnippetTreeItem';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import fetch from 'node-fetch';

interface LicenseResponse {
    email: string;
    licenseKey: string;
    status: string;
    maxDevices: number;
    devices?: string[];
    error?: string;
}

// Function to generate a unique device ID
function getDeviceId(): string {
    const platform = os.platform();
    const release = os.release();
    const arch = os.arch();
    const cpus = os.cpus();
    const username = os.userInfo().username;
    
    // Create a unique string combining system information
    const systemInfo = `${platform}-${release}-${arch}-${cpus[0].model}-${username}`;
    
    // Create a hash of the system info to use as device ID
    return crypto.createHash('sha256').update(systemInfo).digest('hex');
}

// Function to validate license with the backend
async function validateLicense(context: vscode.ExtensionContext, email: string, licenseKey: string): Promise<boolean> {
    try {
        const deviceId = getDeviceId();
        
        const response = await fetch('https://vssnippets.com/api/validate-license', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                email,
                licenseKey,
                deviceId
            })
        });

        const data = await response.json() as LicenseResponse;
        
        if (!response.ok) {
            console.error('License validation failed:', data.error);
            return false;
        }

        if (data.status === 'invalid') {
            console.error('Invalid license key');
            return false;
        }

        if (data.status === 'expired') {
            console.error('License key has expired');
            return false;
        }

        if (data.maxDevices > 0 && data.devices && data.devices.length >= data.maxDevices) {
            console.error('Maximum number of devices reached');
            return false;
        }

        // Store the validated state and details
        await context.globalState.update('vssnippets.licenseValidated', true);
        await context.globalState.update('vssnippets.licenseKey', licenseKey);
        await context.globalState.update('vssnippets.email', data.email);

        return true;
    } catch (error) {
        console.error('License validation error:', error);
        vscode.window.showErrorMessage('Failed to connect to license server. Please check your internet connection.');
        return false;
    }
}

async function shouldShowLicenseModal(context: vscode.ExtensionContext): Promise<boolean> {
    const isLicenseValid = context.globalState.get('vssnippets.licenseValidated');
    if (isLicenseValid) {
        return false;
    }

    const installDate = context.globalState.get<number>('vssnippets.installDate');
    if (!installDate) {
        // First time installation
        await context.globalState.update('vssnippets.installDate', Date.now());
        return false;
    }

    const daysSinceInstall = Math.floor((Date.now() - installDate) / (1000 * 60 * 60 * 24));
    return daysSinceInstall >= 10;
}

async function showLicenseModal(context: vscode.ExtensionContext) {
    try {
        if (!await shouldShowLicenseModal(context)) {
            return;
        }

        const message = 'Thank you for using VS Snippets!\nPlease purchase a license for extended use.';
        const result = await vscode.window.showInformationMessage(
            message,
            { modal: true },
            { title: 'OK', isCloseAffordance: false },
            { title: 'Enter License Key', isCloseAffordance: false }
        );

        if (result?.title === 'Enter License Key') {
            await vscode.commands.executeCommand('snippets.enterLicense');
        } else if (result?.title === 'OK') {
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('https://www.vssnippets.com'));
        }
    } catch (error: any) {
        if (!error.message?.includes('Canceled')) {
            console.error('Error showing license modal:', error);
        }
    }
}

async function showWelcomeMessage(context: vscode.ExtensionContext): Promise<void> {
    try {
        const hasShownWelcome = context.globalState.get('snippets.hasShownWelcome');
        const backupFolder = vscode.workspace.getConfiguration('snippets').get<string>('backupFolder');
        
        if (!hasShownWelcome || !backupFolder) {
            const message = 'Welcome to VS Snippets! 🎉\n\n' +
                'To get started and enable cross-device sync:\n\n' +
                '1. Configure a backup folder (recommended: use Dropbox/Google Drive)\n' +
                '   This allows you to sync your snippets across different computers\n\n' +
                '2. Start saving your code snippets\n' +
                '   Use the sidebar to organize and manage your snippets\n\n' +
                '3. Access them from any computer\n' +
                '   Your snippets will automatically sync when you open VS Code';
            
            const result = await vscode.window.showInformationMessage(
                message,
                { modal: true, detail: 'Choose a cloud storage folder (like Dropbox or Google Drive) to enable cross-device sync.' },
                'Configure Backup Folder',
                'Configure Later'
            );

            if (result === 'Configure Backup Folder') {
                const options: vscode.OpenDialogOptions = {
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    title: 'Select Backup Folder',
                    openLabel: 'Select Folder'
                };

                const folderResult = await vscode.window.showOpenDialog(options);
                if (folderResult && folderResult[0]) {
                    const folderPath = folderResult[0].fsPath;
                    
                    // Save the backup folder path to settings
                    await vscode.workspace.getConfiguration('snippets').update('backupFolder', folderPath, vscode.ConfigurationTarget.Global);
                    
                    // Create snippets.json if it doesn't exist
                    const backupPath = path.join(folderPath, 'snippets.json');
                    if (!await fileExists(backupPath)) {
                        await fs.promises.writeFile(backupPath, JSON.stringify({ version: "1.0", data: [] }));
                    }
                    
                    vscode.window.showInformationMessage(
                        `Backup folder set to: ${folderPath}\n\nTip: To sync between computers, choose a folder in your cloud storage (Dropbox, Google Drive, etc).`
                    );

                    // Mark welcome as shown since they configured the backup
                    await context.globalState.update('snippets.hasShownWelcome', true);
                }
            }
        }
    } catch (error: any) {
        // Only log real errors, ignore cancellation
        if (error.name !== 'Canceled') {
            console.error('Error showing welcome message:', error);
        }
    }
}

async function autoSyncFromBackup(context: vscode.ExtensionContext, localStorage: LocalStorage, treeDataProvider: SnippetTreeDataProvider): Promise<void> {
    try {
        const backupFolder = vscode.workspace.getConfiguration('snippets').get<string>('backupFolder');
        if (!backupFolder) {
            console.log('[DEBUG] No backup folder configured, skipping auto-sync');
            return;
        }

        const backupPath = path.join(backupFolder, 'snippets.json');
        console.log('[DEBUG] Checking for backup file at:', backupPath);

        // Check if backup file exists
        if (!await fileExists(backupPath)) {
            console.log('[DEBUG] No backup file found at:', backupPath);
            return;
        }

        // Get last sync timestamp
        const lastSync = context.globalState.get<number>('vssnippets.lastSync') || 0;
        
        // Get backup file stats
        const stats = await fs.promises.stat(backupPath);
        const backupModified = stats.mtimeMs;

        // Only sync if backup is newer than last sync
        if (backupModified <= lastSync) {
            console.log('[DEBUG] Backup file not modified since last sync');
            return;
        }

        console.log('[DEBUG] Reading backup file for auto-sync');
        const content = await fs.promises.readFile(backupPath, 'utf8');
        const importedData = JSON.parse(content);

        let folders: any[] = [];
        let snippets: any[] = [];

        if (importedData.version === "1.0" && Array.isArray(importedData.data)) {
            console.log('[DEBUG] Processing version 1.0 format for auto-sync');
            importedData.data.forEach((item: any) => {
                if (item.type === 'folder') {
                    const { type, ...folderData } = item;
                    folders.push(folderData);
                } else {
                    snippets.push(item);
                }
            });
        }

        // Get current data
        const currentData = await localStorage.getAllData();

        // Merge the data
        const mergedFolders = mergeFolders(currentData.folders, folders);
        const mergedSnippets = mergeSnippets(currentData.snippets, snippets);

        console.log('[DEBUG] Auto-sync - Merged data:', {
            folders: mergedFolders.length,
            snippets: mergedSnippets.length
        });

        // Sync the merged data
        await localStorage.syncData({
            folders: mergedFolders,
            snippets: mergedSnippets
        });

        // Update last sync timestamp
        await context.globalState.update('vssnippets.lastSync', Date.now());
        
        // Refresh the tree view
        await treeDataProvider.refresh();
        
        console.log('[DEBUG] Auto-sync completed successfully');
    } catch (error) {
        console.error('[DEBUG] Auto-sync error:', error);
        // Don't show error message to user during auto-sync
    }
}

// Add this function to watch for backup file changes
function watchBackupFile(context: vscode.ExtensionContext, localStorage: LocalStorage, treeDataProvider: SnippetTreeDataProvider) {
    const backupFolder = vscode.workspace.getConfiguration('snippets').get<string>('backupFolder');
    if (!backupFolder) {
        return;
    }

    const backupPath = path.join(backupFolder, 'snippets.json');
    const watcher = vscode.workspace.createFileSystemWatcher(backupPath);

    // Watch for changes to the backup file
    watcher.onDidChange(async () => {
        console.log('[DEBUG] Backup file changed, triggering sync');
        await autoSyncFromBackup(context, localStorage, treeDataProvider);
    });

    // Watch for creation of the backup file
    watcher.onDidCreate(async () => {
        console.log('[DEBUG] Backup file created, triggering sync');
        await autoSyncFromBackup(context, localStorage, treeDataProvider);
    });

    return watcher;
}

export async function activate(context: vscode.ExtensionContext) {
    try {
        const localStorage = new LocalStorage();
        const treeDataProvider = new SnippetTreeDataProvider(localStorage);
        const snippetEditor = new SnippetEditor();

        // Show welcome message first
        await showWelcomeMessage(context);

        // Then try to auto-sync
        await autoSyncFromBackup(context, localStorage, treeDataProvider);

        // Set up file watcher for backup file
        const watcher = watchBackupFile(context, localStorage, treeDataProvider);
        if (watcher) {
            context.subscriptions.push(watcher);
        }

        // Watch for configuration changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(async e => {
                if (e.affectsConfiguration('snippets.backupFolder')) {
                    console.log('[DEBUG] Backup folder configuration changed');
                    const watcher = watchBackupFile(context, localStorage, treeDataProvider);
                    if (watcher) {
                        context.subscriptions.push(watcher);
                    }
                    await autoSyncFromBackup(context, localStorage, treeDataProvider);
                }
            })
        );

        // Show license modal if needed
        await showLicenseModal(context);

        // Modify the configureBackupFolder command
        let configureBackupFolder = vscode.commands.registerCommand('snippets.configureBackupFolder', async () => {
            const options: vscode.OpenDialogOptions = {
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                title: 'Select Backup Folder',
                openLabel: 'Select Folder'
            };

            const result = await vscode.window.showOpenDialog(options);
            if (result && result[0]) {
                const folderPath = result[0].fsPath;
                
                // Save the backup folder path to settings
                await vscode.workspace.getConfiguration('snippets').update('backupFolder', folderPath, vscode.ConfigurationTarget.Global);
                
                // Create snippets.json if it doesn't exist
                const backupPath = path.join(folderPath, 'snippets.json');
                if (!await fileExists(backupPath)) {
                    await fs.promises.writeFile(backupPath, JSON.stringify({ version: "1.0", data: [] }));
                }
                
                vscode.window.showInformationMessage(
                    `Backup folder set to: ${folderPath}\n\nTip: To sync between computers, choose a folder in your cloud storage (Dropbox, Google Drive, etc).`
                );

                // Set up new file watcher
                const watcher = watchBackupFile(context, localStorage, treeDataProvider);
                if (watcher) {
                    context.subscriptions.push(watcher);
                }

                // Trigger auto-sync immediately after setting backup folder
                await autoSyncFromBackup(context, localStorage, treeDataProvider);
            }
        });

        // Register help website command
        let openHelpWebsite = vscode.commands.registerCommand('snippets.openHelpWebsite', () => {
            vscode.env.openExternal(vscode.Uri.parse('https://vssnippets.com'));
        });

        // Register the moveToRoot command
        let moveToRootCommand = vscode.commands.registerCommand('snippets.moveToRoot', async (item: SnippetTreeItem) => {
            try {
                // Get the folder ID from the tree item
                const folderId = item.id;
                if (!folderId) {
                    return;
                }

                // Move the folder to root
                await localStorage.moveFolder(folderId, '');

                // Refresh the tree view
                treeDataProvider.refresh();

            } catch (error) {
                vscode.window.showErrorMessage(`Failed to move folder to root: ${error}`);
            }
        });

        // Register move up/down commands
        let moveUpCommand = vscode.commands.registerCommand('snippets.moveUp', async (item: SnippetTreeItem) => {
            try {
                await localStorage.updateFolderOrder(item.id, 'up');
                treeDataProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to move folder up: ${error}`);
            }
        });

        let moveDownCommand = vscode.commands.registerCommand('snippets.moveDown', async (item: SnippetTreeItem) => {
            try {
                await localStorage.updateFolderOrder(item.id, 'down');
                treeDataProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to move folder down: ${error}`);
            }
        });

        // Register the enter license command
        let enterLicenseCommand = vscode.commands.registerCommand('snippets.enterLicense', async () => {
            const email = await vscode.window.showInputBox({
                prompt: 'Please enter your email address',
                placeHolder: 'email@example.com',
                validateInput: (value) => {
                    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Please enter a valid email address';
                }
            });

            if (!email) {
                return showLicenseModal(context);
            }

            const licenseKey = await vscode.window.showInputBox({
                prompt: 'Please enter your license key',
                placeHolder: 'XXXX-XXXX-XXXX-XXXX'
            });

            if (!licenseKey) {
                return showLicenseModal(context);
            }

            try {
                const isValid = await validateLicense(context, email, licenseKey);
                if (isValid) {
                    vscode.window.showInformationMessage('License activated successfully! Thank you for your purchase. 🎉');
                } else {
                    return showLicenseModal(context);
                }
            } catch (error) {
                console.error('License validation error:', error);
                vscode.window.showErrorMessage('Failed to validate license. Please try again or contact support.');
                return showLicenseModal(context);
            }
        });

        // Add the remove license command registration
        let removeLicenseCommand = vscode.commands.registerCommand('snippets.removeLicense', async () => {
            const confirmed = await vscode.window.showWarningMessage(
                'Are you sure you want to remove your license? You will need to enter it again to use the full version.',
                { modal: true },
                'Remove License',
                'Cancel'
            );

            if (confirmed === 'Remove License') {
                try {
                    await context.globalState.update('vssnippets.licenseValidated', false);
                    await context.globalState.update('vssnippets.licenseKey', undefined);
                    await context.globalState.update('vssnippets.email', undefined);
                    vscode.window.showInformationMessage('License has been removed successfully.');
                    await showLicenseModal(context);
                } catch (error) {
                    console.error('Error removing license:', error);
                    vscode.window.showErrorMessage('Failed to remove license. Please try again.');
                }
            }
        });

        // Add disposables to context
        context.subscriptions.push(
            localStorage,
            treeDataProvider,
            snippetEditor,
            configureBackupFolder,
            openHelpWebsite,
            moveToRootCommand,
            moveUpCommand,
            moveDownCommand,
            enterLicenseCommand,
            removeLicenseCommand
        );

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
                handleDrop: async (target: vscode.TreeItem | undefined, sources: vscode.DataTransfer) => {
                    // Pass undefined target when dropping in empty area
                    return treeDataProvider.handleDrop(target as SnippetTreeItem | undefined, sources);
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
                    { label: 'Export Snippets', command: 'snippets.exportSnippets' },
                    { label: 'Enter License Key', command: 'snippets.enterLicense' },
                    { label: 'Remove License', command: 'snippets.removeLicense' },
                    { label: '$(question) Get Help at vssnippets.com', command: 'snippets.openHelpWebsite' }
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
                    placeHolder: 'My Snippets'
                });

                if (name) {
                    try {
                        // Pass only name for root folder (parentId will default to null)
                        await localStorage.addFolder(name);
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
                        // Pass name and parentId
                        await localStorage.addFolder(name, parentItem.id);
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
    } catch (error) {
        console.error('Error during activation:', error);
    }
}

export function deactivate() {
    // Clean up any remaining panels
    SnippetEditor.disposeAll();
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

// Helper function to check if file exists
async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
} 