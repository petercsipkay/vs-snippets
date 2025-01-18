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
    private initialized: boolean = false;

    constructor(private storage: vscode.Memento) {
        // Initialize storage asynchronously and track completion
        this.initializeStorage().then(() => {
            this.initialized = true;
            console.log('Storage initialization complete');
        }).catch(err => {
            console.error('Failed to initialize storage:', err);
        });
    }

    private async waitForInitialization() {
        if (!this.initialized) {
            console.log('Waiting for storage initialization...');
            await new Promise<void>((resolve) => {
                const check = () => {
                    if (this.initialized) {
                        resolve();
                    } else {
                        setTimeout(check, 100);
                    }
                };
                check();
            });
            console.log('Storage initialization complete');
        }
    }

    private async initializeStorage() {
        try {
            console.log('Initializing storage...');
            // Try to get configured storage location
            const config = vscode.workspace.getConfiguration('snippets');
            let configuredPath = await config.get<string>('storageLocation');

            if (!configuredPath) {
                // Try different locations in order of preference
                const possibleLocations = [
                    path.join(os.homedir(), 'Documents', 'CodeSnippets'),
                    path.join(os.homedir(), '.vscode', 'snippets'),
                    path.join(os.homedir(), '.snippets'),
                    path.join(process.env.HOME || os.homedir(), '.config', 'code-snippets'),
                    path.join(os.homedir(), 'Library', 'Application Support', 'CodeSnippets')
                ];

                for (const location of possibleLocations) {
                    try {
                        console.log(`Trying storage location: ${location}`);
                        await fs.promises.mkdir(location, { recursive: true, mode: 0o755 });
                        await fs.promises.access(location, fs.constants.W_OK);
                        configuredPath = location;
                        await config.update('storageLocation', location, true);
                        console.log(`Successfully configured storage at: ${location}`);
                        break;
                    } catch (err) {
                        console.log(`Failed to use location ${location}:`, err);
                        continue;
                    }
                }

                if (!configuredPath) {
                    console.error('Could not find a writable storage location');
                    this.storageDir = null;
                    return;
                }
            }

            // Verify the configured path is accessible
            try {
                console.log(`Verifying storage location: ${configuredPath}`);
                await fs.promises.mkdir(configuredPath, { recursive: true, mode: 0o755 });
                await fs.promises.access(configuredPath, fs.constants.W_OK);
                this.storageDir = configuredPath;
                console.log('Storage directory verified and accessible');

                // Initialize empty files if they don't exist
                const foldersPath = path.join(this.storageDir, 'folders.json');
                const snippetsPath = path.join(this.storageDir, 'snippets.json');

                if (!fs.existsSync(foldersPath)) {
                    await fs.promises.writeFile(foldersPath, '[]', { mode: 0o600 });
                }
                if (!fs.existsSync(snippetsPath)) {
                    await fs.promises.writeFile(snippetsPath, '[]', { mode: 0o600 });
                }
            } catch (err) {
                console.error('Failed to access configured storage location:', err);
                this.storageDir = null;
            }
        } catch (err) {
            console.error('Error initializing storage:', err);
            this.storageDir = null;
        }
    }

    private async ensureStorageInitialized(): Promise<boolean> {
        if (!this.storageDir) {
            await this.initializeStorage();
        }
        return !!this.storageDir;
    }

    private async getFoldersData(): Promise<Folder[]> {
        try {
            if (!await this.ensureStorageInitialized()) {
                return this.storage.get('folders', []);
            }

            const foldersPath = path.join(this.storageDir!, 'folders.json');
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
            if (!await this.ensureStorageInitialized()) {
                return this.storage.get('snippets', []);
            }

            const snippetsPath = path.join(this.storageDir!, 'snippets.json');
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
            if (!await this.ensureStorageInitialized()) {
                await this.storage.update('folders', folders);
                return;
            }

            const foldersPath = path.join(this.storageDir!, 'folders.json');
            await fs.promises.writeFile(foldersPath, JSON.stringify(folders, null, 2), { mode: 0o600 });
        } catch (err) {
            console.error('Failed to save folders:', err);
            // Fallback to memento storage
            await this.storage.update('folders', folders);
        }
    }

    private async saveSnippetsData(snippets: Snippet[]): Promise<void> {
        try {
            if (!await this.ensureStorageInitialized()) {
                await this.storage.update('snippets', snippets);
                return;
            }

            const snippetsPath = path.join(this.storageDir!, 'snippets.json');
            await fs.promises.writeFile(snippetsPath, JSON.stringify(snippets, null, 2), { mode: 0o600 });
        } catch (err) {
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
        try {
            await this.waitForInitialization();
            console.log('Deleting snippet with ID:', snippetId);
            const snippets = await this.getSnippetsData();
            console.log('Current snippets count:', snippets.length);
            const updatedSnippets = snippets.filter(s => s.id !== snippetId);
            console.log('Updated snippets count:', updatedSnippets.length);
            await this.saveSnippetsData(updatedSnippets);
            console.log('Snippet deleted successfully');
        } catch (error) {
            console.error('Error deleting snippet:', error);
            throw error;
        }
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

    async exportData(): Promise<string> {
        try {
            const data = await this.getAllData();
            const exportData = {
                version: "1.0",
                timestamp: new Date().toISOString(),
                data: {
                    folders: data.folders.map(folder => ({
                        id: folder.id,
                        name: folder.name
                    })),
                    snippets: data.snippets.map(snippet => ({
                        id: snippet.id,
                        name: snippet.name,
                        code: snippet.code,
                        notes: snippet.notes || "",
                        folderId: snippet.folderId,
                        language: snippet.language || "plaintext"
                    }))
                }
            };
            
            return JSON.stringify(exportData, null, 2);
        } catch (error: any) {
            console.error('Error exporting data:', error);
            throw new Error(`Failed to export data: ${error.message}`);
        }
    }

    async importData(jsonData: string): Promise<void> {
        try {
            const importedData = JSON.parse(jsonData);
            
            // Validate the imported data structure
            if (!importedData.version || !importedData.data) {
                throw new Error('Invalid import file format');
            }

            // Version compatibility check
            if (importedData.version !== "1.0") {
                console.log(`Warning: Importing data from version ${importedData.version}`);
            }

            const { folders, snippets } = importedData.data;

            // Validate folders
            if (!Array.isArray(folders)) {
                throw new Error('Invalid folders data');
            }

            // Validate snippets
            if (!Array.isArray(snippets)) {
                throw new Error('Invalid snippets data');
            }

            // Validate each folder has required fields
            folders.forEach((folder: any, index: number) => {
                if (!folder.id || !folder.name) {
                    throw new Error(`Invalid folder data at index ${index}`);
                }
            });

            // Validate each snippet has required fields
            snippets.forEach((snippet: any, index: number) => {
                if (!snippet.id || !snippet.name || !snippet.code || !snippet.folderId) {
                    throw new Error(`Invalid snippet data at index ${index}`);
                }
            });

            // Create a map of existing folders and snippets
            const currentData = await this.getAllData();
            const existingFolders = new Map(currentData.folders.map(f => [f.id, f]));
            const existingSnippets = new Map(currentData.snippets.map(s => [s.id, s]));

            // Merge folders
            const mergedFolders = new Map<string, Folder>();
            
            // Add existing folders
            existingFolders.forEach((folder, id) => {
                mergedFolders.set(id, folder);
            });

            // Add/update imported folders
            folders.forEach((folder: Folder) => {
                mergedFolders.set(folder.id, {
                    id: folder.id,
                    name: folder.name
                });
            });

            // Merge snippets
            const mergedSnippets = new Map<string, Snippet>();
            
            // Add existing snippets
            existingSnippets.forEach((snippet, id) => {
                mergedSnippets.set(id, snippet);
            });

            // Add/update imported snippets
            snippets.forEach((snippet: Snippet) => {
                mergedSnippets.set(snippet.id, {
                    id: snippet.id,
                    name: snippet.name,
                    code: snippet.code,
                    notes: snippet.notes || "",
                    folderId: snippet.folderId,
                    language: snippet.language || "plaintext"
                });
            });

            // Convert maps back to arrays
            const finalData = {
                folders: Array.from(mergedFolders.values()),
                snippets: Array.from(mergedSnippets.values())
            };

            // Save the merged data
            await this.syncData(finalData);

            console.log('Import completed successfully:', {
                folders: finalData.folders.length,
                snippets: finalData.snippets.length
            });
        } catch (error: any) {
            console.error('Error importing data:', error);
            throw new Error(`Failed to import data: ${error.message}`);
        }
    }
} 