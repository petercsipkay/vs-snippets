import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Folder, Snippet } from './types';

interface SnippetUpdate {
    id: string;
    code?: string;
    notes?: string;
    language?: string;
    tags?: string[];
    folderId?: string;
}

export class LocalStorage {
    private initialized: boolean = false;
    private storagePath: string;

    constructor() {
        this.storagePath = path.join(os.homedir(), '.vscode', 'snippets');
        this.initializeStorage().catch(error => {
            console.error('Failed to initialize storage:', error);
        });
    }

    private async initializeStorage(): Promise<void> {
        try {
            // Create storage directory if it doesn't exist
            await fs.promises.mkdir(this.storagePath, { recursive: true });

            // Create folders.json if it doesn't exist
            const foldersPath = path.join(this.storagePath, 'folders.json');
            if (!await this.fileExists(foldersPath)) {
                await fs.promises.writeFile(foldersPath, '[]');
            }

            // Create snippets.json if it doesn't exist
            const snippetsPath = path.join(this.storagePath, 'snippets.json');
            if (!await this.fileExists(snippetsPath)) {
                await fs.promises.writeFile(snippetsPath, '[]');
            }

            this.initialized = true;
        } catch (error) {
            console.error('Error initializing storage:', error);
            throw error;
        }
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.promises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    private async waitForInitialization(): Promise<void> {
        if (!this.initialized) {
            await this.initializeStorage();
        }
    }

    private async getFoldersData(): Promise<Folder[]> {
        await this.waitForInitialization();
        const foldersPath = path.join(this.storagePath, 'folders.json');
        const data = await fs.promises.readFile(foldersPath, 'utf8');
        return JSON.parse(data);
    }

    private async getSnippetsData(): Promise<Snippet[]> {
        await this.waitForInitialization();
        const snippetsPath = path.join(this.storagePath, 'snippets.json');
        const data = await fs.promises.readFile(snippetsPath, 'utf8');
        return JSON.parse(data);
    }

    private async saveFoldersData(folders: Folder[]): Promise<void> {
        await this.waitForInitialization();
        const foldersPath = path.join(this.storagePath, 'folders.json');
        await fs.promises.writeFile(foldersPath, JSON.stringify(folders, null, 2));

        // Sync to backup file if configured
        await this.saveToBackup();
    }

    private async saveSnippetsData(snippets: Snippet[]): Promise<void> {
        await this.waitForInitialization();
        const snippetsPath = path.join(this.storagePath, 'snippets.json');
        await fs.promises.writeFile(snippetsPath, JSON.stringify(snippets, null, 2));

        // Sync to backup file if configured
        await this.saveToBackup();
    }

    // New helper method to save everything to a single backup file
    private async saveToBackup(): Promise<void> {
        const backupFolder = vscode.workspace.getConfiguration('snippets').get<string>('backupFolder');
        if (!backupFolder) {
            return;
        }

        try {
            // Get all current data
            const data = await this.getAllData();
            
            // Convert folders to have type='folder'
            const folders = data.folders.map(folder => ({
                ...folder,
                type: 'folder'
            }));

            // Combine into a single array
            const combinedData = [...folders, ...data.snippets];

            // Save to the backup file
            const backupPath = path.join(backupFolder, 'snippets.json');
            await fs.promises.mkdir(backupFolder, { recursive: true });
            await fs.promises.writeFile(backupPath, JSON.stringify(combinedData, null, 2));
            
            console.log('[DEBUG] Saved to backup file:', backupPath);
        } catch (error) {
            console.error('[DEBUG] Error saving to backup:', error);
        }
    }

    async getFolders(): Promise<Folder[]> {
        return this.getFoldersData();
    }

    async getSubFolders(parentId: string): Promise<Folder[]> {
        const folders = await this.getFoldersData();
        return folders.filter(f => f.parentId === parentId);
    }

    async getRootFolders(): Promise<Folder[]> {
        const folders = await this.getFoldersData();
        return folders.filter(f => f.parentId === null);
    }

    async getSnippets(): Promise<Snippet[]> {
        return this.getSnippetsData();
    }

    async getAllSnippets(): Promise<Snippet[]> {
        return this.getSnippetsData();
    }

    async addFolder(name: string, parentId: string | null = null, type: 'primary' | 'secondary' = 'primary'): Promise<Folder> {
        await this.waitForInitialization();
        const newFolder: Folder = {
            id: Date.now().toString(),
            name,
            parentId,
            type
        };

        const folders = await this.getFolders();
        folders.push(newFolder);
        await this.saveFoldersData(folders);
        return newFolder;
    }

    async addSnippet(snippet: Omit<Snippet, 'id'>): Promise<Snippet> {
        await this.waitForInitialization();
        const newSnippet: Snippet = {
            id: Date.now().toString(),
            ...snippet
        };

        const snippets = await this.getSnippets();
        snippets.push(newSnippet);
        await this.saveSnippetsData(snippets);
        return newSnippet;
    }

    async deleteFolder(id: string): Promise<void> {
        await this.waitForInitialization();
        const folders = await this.getFolders();
        const snippets = await this.getSnippets();

        // Remove the folder
        const updatedFolders = folders.filter(folder => folder.id !== id);
        // Remove all snippets in the folder
        const updatedSnippets = snippets.filter(snippet => snippet.folderId !== id);

        await this.saveFoldersData(updatedFolders);
        await this.saveSnippetsData(updatedSnippets);
    }

    async deleteSnippet(id: string): Promise<void> {
        await this.waitForInitialization();
        const snippets = await this.getSnippets();
        const updatedSnippets = snippets.filter(snippet => snippet.id !== id);
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
        await this.waitForInitialization();
        await this.saveFoldersData(data.folders);
        await this.saveSnippetsData(data.snippets);
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
                if (!folder.id || typeof folder.id !== 'string' || !folder.name || typeof folder.name !== 'string') {
                    throw new Error(`Invalid folder data at index ${index}`);
                }
            });

            // Validate each snippet has required fields
            snippets.forEach((snippet: any, index: number) => {
                if (!snippet.id || typeof snippet.id !== 'string' || 
                    !snippet.name || typeof snippet.name !== 'string' || 
                    typeof snippet.code !== 'string' || // code can be empty but must be string
                    !snippet.folderId || typeof snippet.folderId !== 'string') {
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
                    name: folder.name,
                    type: folder.type,
                    parentId: folder.parentId
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
                    code: snippet.code || "",
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