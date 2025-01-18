import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface Folder {
    id: string;
    name: string;
}

interface Snippet {
    id: string;
    name: string;
    code: string;
    notes: string;
    folderId: string;
    language?: string;
}

interface SnippetUpdate {
    id: string;
    code?: string;
    notes?: string;
    language?: string;
    tags?: string[];
}

export class LocalStorage {
    private storageDir: string | null = null;

    constructor(private storage: vscode.Memento) {
        this.initializeStorage();
    }

    private async initializeStorage() {
        try {
            // Try to get configured storage location
            const config = vscode.workspace.getConfiguration('snippets');
            let configuredPath = await config.get<string>('storageLocation');

            if (!configuredPath) {
                // Use the existing CodeSnippets directory
                const defaultPath = path.join(os.homedir(), 'Library', 'Application Support', 'CodeSnippets');
                
                try {
                    console.log(`Using default storage directory: ${defaultPath}`);
                    // Try to access the directory first
                    try {
                        await fs.promises.access(defaultPath, fs.constants.W_OK);
                        console.log('Directory exists and is writable');
                    } catch (err) {
                        // If directory doesn't exist or isn't writable, try to create it
                        console.log('Creating directory with proper permissions');
                        await fs.promises.mkdir(defaultPath, { recursive: true, mode: 0o755 });
                        await fs.promises.access(defaultPath, fs.constants.W_OK);
                    }
                    
                    configuredPath = defaultPath;
                    await config.update('storageLocation', defaultPath, true);
                    console.log('Successfully configured storage directory');
                } catch (err: any) {
                    console.error('Failed to use default directory:', err);
                    // If we can't use the default directory, ask user to select a location
                    const result = await vscode.window.showErrorMessage(
                        'Cannot access the default storage directory. Would you like to select a custom location?',
                        { modal: true },
                        'Select Location'
                    );

                    if (result === 'Select Location') {
                        const uri = await vscode.window.showOpenDialog({
                            canSelectFiles: false,
                            canSelectFolders: true,
                            canSelectMany: false,
                            openLabel: 'Select Storage Location',
                            title: 'Select Snippets Storage Location',
                            defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Documents'))
                        });

                        if (uri && uri[0]) {
                            const selectedPath = uri[0].fsPath;
                            await fs.promises.mkdir(selectedPath, { recursive: true, mode: 0o755 });
                            await fs.promises.access(selectedPath, fs.constants.W_OK);
                            configuredPath = selectedPath;
                            await config.update('storageLocation', selectedPath, true);
                            console.log(`Using user-selected directory: ${selectedPath}`);
                        }
                    }
                }
            }

            if (configuredPath) {
                try {
                    await fs.promises.access(configuredPath, fs.constants.W_OK);
                    this.storageDir = configuredPath;
                    console.log('Using storage directory:', this.storageDir);
                } catch (err: any) {
                    console.error('Failed to access storage directory:', err);
                    const result = await vscode.window.showErrorMessage(
                        `Failed to access storage directory: ${err.message}. Would you like to select a different location?`,
                        { modal: true },
                        'Select New Location'
                    );

                    if (result === 'Select New Location') {
                        await config.update('storageLocation', undefined, true);
                        await this.initializeStorage();
                    }
                }
            } else {
                const result = await vscode.window.showErrorMessage(
                    'No valid storage location configured. Would you like to select a location?',
                    { modal: true },
                    'Select Location'
                );

                if (result === 'Select Location') {
                    await config.update('storageLocation', undefined, true);
                    await this.initializeStorage();
                }
            }
        } catch (err: any) {
            console.error('Error initializing storage:', err);
            vscode.window.showErrorMessage(`Failed to initialize storage: ${err.message}`);
        }
    }

    private async getFoldersData(): Promise<Folder[]> {
        try {
            if (!this.storageDir) {
                await this.initializeStorage();
                if (!this.storageDir) {
                    return this.storage.get('folders', []);
                }
            }

            const foldersPath = path.join(this.storageDir, 'folders.json');
            try {
                const data = await fs.promises.readFile(foldersPath, 'utf8');
                return JSON.parse(data);
            } catch (err) {
                // If file doesn't exist or is invalid, return empty array
                return [];
            }
        } catch (err) {
            // Fallback to memento storage
            return this.storage.get('folders', []);
        }
    }

    private async getSnippetsData(): Promise<Snippet[]> {
        try {
            if (!this.storageDir) {
                await this.initializeStorage();
                if (!this.storageDir) {
                    return this.storage.get('snippets', []);
                }
            }

            const snippetsPath = path.join(this.storageDir, 'snippets.json');
            try {
                const data = await fs.promises.readFile(snippetsPath, 'utf8');
                return JSON.parse(data);
            } catch (err) {
                // If file doesn't exist or is invalid, return empty array
                return [];
            }
        } catch (err) {
            // Fallback to memento storage
            return this.storage.get('snippets', []);
        }
    }

    private async saveFoldersData(folders: Folder[]): Promise<void> {
        try {
            if (!this.storageDir) {
                await this.initializeStorage();
                if (!this.storageDir) {
                    await this.storage.update('folders', folders);
                    return;
                }
            }

            // Ensure the directory exists with proper permissions
            try {
                await fs.promises.mkdir(this.storageDir, { recursive: true, mode: 0o700 });
                await fs.promises.access(this.storageDir, fs.constants.W_OK);
            } catch (err: any) {
                console.error('Failed to ensure storage directory exists:', err);
                // If we can't create/access the directory, fall back to memento storage
                await this.storage.update('folders', folders);
                return;
            }

            const foldersPath = path.join(this.storageDir, 'folders.json');
            await fs.promises.writeFile(foldersPath, JSON.stringify(folders, null, 2), { mode: 0o600 });
        } catch (err: any) {
            console.error('Failed to save folders:', err);
            // Fallback to memento storage
            await this.storage.update('folders', folders);
        }
    }

    private async saveSnippetsData(snippets: Snippet[]): Promise<void> {
        try {
            if (!this.storageDir) {
                await this.initializeStorage();
                if (!this.storageDir) {
                    await this.storage.update('snippets', snippets);
                    return;
                }
            }

            // Ensure the directory exists with proper permissions
            try {
                await fs.promises.mkdir(this.storageDir, { recursive: true, mode: 0o700 });
                await fs.promises.access(this.storageDir, fs.constants.W_OK);
            } catch (err: any) {
                console.error('Failed to ensure storage directory exists:', err);
                // If we can't create/access the directory, fall back to memento storage
                await this.storage.update('snippets', snippets);
                return;
            }

            const snippetsPath = path.join(this.storageDir, 'snippets.json');
            await fs.promises.writeFile(snippetsPath, JSON.stringify(snippets, null, 2), { mode: 0o600 });
        } catch (err: any) {
            console.error('Failed to save snippets:', err);
            // Fallback to memento storage
            await this.storage.update('snippets', snippets);
        }
    }

    async getFolders(): Promise<Folder[]> {
        return this.getFoldersData();
    }

    async getSnippets(folderId: string): Promise<Snippet[]> {
        const snippets = await this.getSnippetsData();
        return snippets.filter(s => s.folderId === folderId);
    }

    async getAllSnippets(): Promise<Snippet[]> {
        return this.getSnippetsData();
    }

    async addFolder(name: string): Promise<void> {
        const folders = await this.getFoldersData();
        folders.push({
            id: Date.now().toString(),
            name
        });
        await this.saveFoldersData(folders);
    }

    async addSnippet(snippet: Partial<Snippet>): Promise<void> {
        const snippets = await this.getSnippetsData();
        snippets.push({
            ...snippet,
            id: Date.now().toString()
        } as Snippet);
        await this.saveSnippetsData(snippets);
    }

    async deleteFolder(folderId: string): Promise<void> {
        const folders = await this.getFoldersData();
        const snippets = await this.getSnippetsData();
        
        // Remove folder
        const updatedFolders = folders.filter(f => f.id !== folderId);
        await this.saveFoldersData(updatedFolders);
        
        // Remove all snippets in the folder
        const updatedSnippets = snippets.filter(s => s.folderId !== folderId);
        await this.saveSnippetsData(updatedSnippets);
    }

    async deleteSnippet(snippetId: string): Promise<void> {
        const snippets = await this.getSnippetsData();
        const updatedSnippets = snippets.filter(s => s.id !== snippetId);
        await this.saveSnippetsData(updatedSnippets);
    }

    async updateSnippet(update: SnippetUpdate): Promise<void> {
        const snippets = await this.getSnippetsData();
        const snippetIndex = snippets.findIndex(s => s.id === update.id);
        
        if (snippetIndex !== -1) {
            snippets[snippetIndex] = {
                ...snippets[snippetIndex],
                ...update
            };
            await this.saveSnippetsData(snippets);
        }
    }

    async getSnippet(snippetId: string): Promise<Snippet | undefined> {
        const snippets = await this.getSnippetsData();
        return snippets.find(s => s.id === snippetId);
    }

    async getAllData(): Promise<{ folders: Folder[]; snippets: Snippet[] }> {
        return {
            folders: await this.getFoldersData(),
            snippets: await this.getSnippetsData()
        };
    }

    async syncData(data: { folders: Folder[]; snippets: Snippet[] }): Promise<void> {
        try {
            console.log('Starting data sync...');
            console.log('Incoming data:', {
                folders: data.folders.length,
                snippets: data.snippets.length
            });

            // Get current data
            const currentFolders = await this.getFoldersData();
            const currentSnippets = await this.getSnippetsData();

            console.log('Current data:', {
                folders: currentFolders.length,
                snippets: currentSnippets.length
            });

            // Merge folders
            const mergedFolders = new Map<string, Folder>();
            
            // Add current folders
            currentFolders.forEach(folder => {
                mergedFolders.set(folder.id, folder);
            });
            
            // Add/update new folders
            data.folders.forEach(folder => {
                mergedFolders.set(folder.id, folder);
            });

            // Merge snippets
            const mergedSnippets = new Map<string, Snippet>();
            
            // Add current snippets
            currentSnippets.forEach(snippet => {
                mergedSnippets.set(snippet.id, snippet);
            });
            
            // Add/update new snippets
            data.snippets.forEach(snippet => {
                mergedSnippets.set(snippet.id, snippet);
            });

            // Convert maps back to arrays
            const finalFolders = Array.from(mergedFolders.values());
            const finalSnippets = Array.from(mergedSnippets.values());

            console.log('Merged data:', {
                folders: finalFolders.length,
                snippets: finalSnippets.length
            });

            // Save merged data
            await this.saveFoldersData(finalFolders);
            await this.saveSnippetsData(finalSnippets);

            console.log('Sync completed successfully');
        } catch (error: any) {
            console.error('Error during sync:', error);
            throw new Error(`Failed to sync data: ${error.message}`);
        }
    }

    async renameFolder(folderId: string, newName: string): Promise<void> {
        const folders = await this.getFoldersData();
        const folderIndex = folders.findIndex(f => f.id === folderId);
        
        if (folderIndex !== -1) {
            folders[folderIndex].name = newName;
            await this.saveFoldersData(folders);
        }
    }

    async renameSnippet(snippetId: string, newName: string): Promise<void> {
        const snippets = await this.getSnippetsData();
        const snippetIndex = snippets.findIndex(s => s.id === snippetId);
        
        if (snippetIndex !== -1) {
            snippets[snippetIndex].name = newName;
            await this.saveSnippetsData(snippets);
        }
    }
} 