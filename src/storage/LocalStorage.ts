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
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.storagePath = path.join(os.homedir(), '.vscode', 'snippets');
        this.initializeStorage().catch(error => {
            console.error('Failed to initialize storage:', error);
        });
    }

    dispose() {
        // Clean up any disposables
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.initialized = false;
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
        console.log('[DEBUG] Reading folders from:', foldersPath);
        const data = await fs.promises.readFile(foldersPath, 'utf8');
        console.log('[DEBUG] Raw folders data:', data);
        const folders = JSON.parse(data);
        console.log('[DEBUG] Parsed folders:', {
            count: folders.length,
            folders: folders
        });
        return folders;
    }

    private async getSnippetsData(): Promise<Snippet[]> {
        await this.waitForInitialization();
        const snippetsPath = path.join(this.storagePath, 'snippets.json');
        console.log('[DEBUG] Reading snippets from:', snippetsPath);

        try {
            const data = await fs.promises.readFile(snippetsPath, 'utf8');
            console.log('[DEBUG] Raw snippets data:', data);

            const parsedSnippets = JSON.parse(data);
            
            // Ensure all snippets have the required fields with proper defaults
            const sanitizedSnippets = parsedSnippets.map((snippet: any) => ({
                id: snippet.id,
                name: snippet.name,
                folderId: snippet.folderId,
                code: snippet.code || '',
                language: snippet.language || 'plaintext',
                notes: snippet.notes || '',
                tags: Array.isArray(snippet.tags) ? snippet.tags : [],
                lastModified: snippet.lastModified || Date.now()
            }));

            console.log('[DEBUG] Parsed and sanitized snippets:', {
                count: sanitizedSnippets.length,
                snippets: sanitizedSnippets
            });

            return sanitizedSnippets;
        } catch (error) {
            console.error('[DEBUG] Error reading snippets:', error);
            throw error;
        }
    }

    private async saveFoldersData(folders: Folder[]): Promise<void> {
        await this.waitForInitialization();
        console.log('[DEBUG] Saving folders to storage:', {
            count: folders.length,
            folders: folders
        });
        const foldersPath = path.join(this.storagePath, 'folders.json');
        await fs.promises.writeFile(foldersPath, JSON.stringify(folders, null, 2));
        console.log('[DEBUG] Folders saved to:', foldersPath);
        
        // Verify the file was written correctly
        try {
            const savedContent = await fs.promises.readFile(foldersPath, 'utf8');
            const savedFolders = JSON.parse(savedContent);
            console.log('[DEBUG] Verified folders file content:', {
                path: foldersPath,
                content: savedContent,
                parsed: savedFolders,
                count: savedFolders.length
            });
        } catch (error) {
            console.error('[DEBUG] Error verifying folders file:', error);
        }
    }

    private async saveSnippetsData(snippets: Snippet[]): Promise<void> {
        await this.waitForInitialization();
        console.log('[DEBUG] Saving snippets to storage:', {
            count: snippets.length,
            snippets: snippets
        });

        // Ensure all snippets have the required fields with proper defaults
        const sanitizedSnippets = snippets.map(snippet => ({
            id: snippet.id,
            name: snippet.name,
            folderId: snippet.folderId,
            code: snippet.code || '',
            language: snippet.language || 'plaintext',
            notes: snippet.notes || '',
            tags: Array.isArray(snippet.tags) ? snippet.tags : [],
            lastModified: snippet.lastModified || Date.now()
        }));

        const snippetsPath = path.join(this.storagePath, 'snippets.json');
        const snippetsJson = JSON.stringify(sanitizedSnippets, null, 2);
        
        console.log('[DEBUG] Writing snippets to file:', {
            path: snippetsPath,
            content: snippetsJson
        });

        await fs.promises.writeFile(snippetsPath, snippetsJson);
        console.log('[DEBUG] Snippets saved to:', snippetsPath);
        
        // Verify the file was written correctly
        try {
            const savedContent = await fs.promises.readFile(snippetsPath, 'utf8');
            const savedSnippets = JSON.parse(savedContent);
            console.log('[DEBUG] Verified snippets file content:', {
                path: snippetsPath,
                content: savedContent,
                parsed: savedSnippets,
                count: savedSnippets.length
            });
        } catch (error) {
            console.error('[DEBUG] Error verifying snippets file:', error);
            throw error;
        }
    }

    // Method to get data from backup file without syncing
    async getBackupData(): Promise<{ folders: Folder[]; snippets: Snippet[]; timestamp: string } | null> {
        const backupFolder = vscode.workspace.getConfiguration('snippets').get<string>('backupFolder');
        if (!backupFolder) {
            throw new Error('Backup folder not configured');
        }

        try {
            const backupPath = path.join(backupFolder, 'snippets.json');
            if (!await this.fileExists(backupPath)) {
                return null;
            }

            const backupContent = await fs.promises.readFile(backupPath, 'utf8');
            const backupData = JSON.parse(backupContent);

            if (!backupData.data || !Array.isArray(backupData.data)) {
                throw new Error('Invalid backup file format');
            }

            // Separate into folders and snippets
            const folders: Folder[] = [];
            const snippets: Snippet[] = [];
            backupData.data.forEach((item: any) => {
                if (item.type === 'folder') {
                    const { type, ...folderData } = item;
                    folders.push(folderData);
                } else {
                    snippets.push(item);
                }
            });

            return {
                folders,
                snippets,
                timestamp: backupData.timestamp
            };
        } catch (error) {
            console.error('[DEBUG] Error reading backup:', error);
            throw error;
        }
    }

    // Method to sync from backup file
    async syncFromBackup(): Promise<void> {
        const backupData = await this.getBackupData();
        if (!backupData) {
            throw new Error('No backup data found');
        }

        // Get current data
        const currentData = await this.getAllData();
        const currentItems = new Map();
        [...currentData.folders, ...currentData.snippets].forEach(item => {
            currentItems.set(item.id, item);
        });

        // Merge with backup data, keeping newer versions
        const mergedItems = new Map(currentItems);
        [...backupData.folders, ...backupData.snippets].forEach(item => {
            const current = currentItems.get(item.id);
            if (!current || item.lastModified > current.lastModified) {
                mergedItems.set(item.id, item);
            }
        });

        // Separate into folders and snippets
        const folders: Folder[] = [];
        const snippets: Snippet[] = [];
        mergedItems.forEach(item => {
            if ('type' in item) {
                const { type, ...folderData } = item;
                folders.push(folderData as Folder);
            } else {
                snippets.push(item as Snippet);
            }
        });

        // Save merged data
        await this.syncData({ folders, snippets });
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
            type,
            lastModified: Date.now()
        };

        const folders = await this.getFolders();
        folders.push(newFolder);
        await this.saveFoldersData(folders);
        await this.updateBackupFile({ folders, snippets: await this.getSnippetsData() });
        return newFolder;
    }

    async addSnippet(snippet: Omit<Snippet, 'id' | 'lastModified'>): Promise<Snippet> {
        await this.waitForInitialization();
        console.log('[DEBUG] Adding new snippet:', snippet);

        // Create a properly structured new snippet
        const newSnippet: Snippet = {
            id: Date.now().toString(),
            name: snippet.name,
            folderId: snippet.folderId,
            code: snippet.code || '',
            language: snippet.language || 'plaintext',
            notes: snippet.notes || '',
            tags: snippet.tags || [],
            lastModified: Date.now()
        };

        console.log('[DEBUG] Created new snippet object:', newSnippet);

        const snippets = await this.getSnippets();
        snippets.push(newSnippet);

        // Save the updated snippets array
        await this.saveSnippetsData(snippets);
        
        // Update the backup file
        await this.updateBackupFile({ 
            folders: await this.getFoldersData(), 
            snippets 
        });

        console.log('[DEBUG] Snippet added successfully');
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
        await this.updateBackupFile({ folders: updatedFolders, snippets: updatedSnippets });
    }

    async deleteSnippet(id: string): Promise<void> {
        await this.waitForInitialization();
        const snippets = await this.getSnippets();
        const updatedSnippets = snippets.filter(snippet => snippet.id !== id);
        await this.saveSnippetsData(updatedSnippets);
        await this.updateBackupFile({ folders: await this.getFoldersData(), snippets: updatedSnippets });
    }

    async updateSnippet(update: SnippetUpdate): Promise<void> {
        console.log('[DEBUG] Updating snippet:', update);
        const snippets = await this.getSnippetsData();
        const snippetIndex = snippets.findIndex(s => s.id === update.id);
        
        if (snippetIndex !== -1) {
            // Create a new snippet object with the updates
            const currentSnippet = snippets[snippetIndex];
            const updatedSnippet = {
                ...currentSnippet,
                code: update.code !== undefined ? update.code : currentSnippet.code,
                notes: update.notes !== undefined ? update.notes : currentSnippet.notes,
                language: update.language !== undefined ? update.language : currentSnippet.language,
                tags: update.tags !== undefined ? update.tags : currentSnippet.tags,
                folderId: update.folderId !== undefined ? update.folderId : currentSnippet.folderId,
                lastModified: Date.now()
            };

            console.log('[DEBUG] Current snippet:', currentSnippet);
            console.log('[DEBUG] Updated snippet:', updatedSnippet);

            // Replace the old snippet with the updated one
            snippets[snippetIndex] = updatedSnippet;

            // Save the updated snippets array
            await this.saveSnippetsData(snippets);
            
            // Update the backup file
            await this.updateBackupFile({ 
                folders: await this.getFoldersData(), 
                snippets 
            });

            console.log('[DEBUG] Snippet updated successfully');
        } else {
            console.error('[DEBUG] Snippet not found:', update.id);
            throw new Error('Snippet not found');
        }
    }

    async getSnippet(snippetId: string): Promise<Snippet | undefined> {
        const snippets = await this.getSnippetsData();
        return snippets.find(s => s.id === snippetId);
    }

    async getAllData(): Promise<{ folders: Folder[]; snippets: Snippet[] }> {
        console.log('[DEBUG] Getting all data');
        const data = {
            folders: await this.getFoldersData(),
            snippets: await this.getSnippetsData()
        };
        console.log('[DEBUG] Retrieved data:', {
            folders: data.folders.length,
            snippets: data.snippets.length,
            folderDetails: data.folders,
            snippetDetails: data.snippets
        });
        return data;
    }

    private async updateBackupFile(data: { folders: Folder[]; snippets: Snippet[] }): Promise<void> {
        const backupFolder = vscode.workspace.getConfiguration('snippets').get<string>('backupFolder');
        if (!backupFolder) {
            console.log('[DEBUG] No backup folder configured, skipping backup update');
            return;
        }

        try {
            // Create backup folder if it doesn't exist
            await fs.promises.mkdir(backupFolder, { recursive: true });
            const backupPath = path.join(backupFolder, 'snippets.json');
            console.log('[DEBUG] Updating backup file at:', backupPath);

            // Convert to backup format - ensure it matches the export format exactly
            const backupData = {
                version: "1.0",
                timestamp: new Date().toISOString(),
                data: [
                    ...data.folders.map(folder => ({
                        id: folder.id,
                        name: folder.name,
                        parentId: folder.parentId,
                        type: 'folder',
                        lastModified: folder.lastModified || Date.now()
                    })),
                    ...data.snippets.map(snippet => ({
                        id: snippet.id,
                        name: snippet.name,
                        folderId: snippet.folderId,
                        code: snippet.code || '',
                        language: snippet.language || 'plaintext',
                        notes: snippet.notes || '',
                        tags: snippet.tags || [],
                        lastModified: snippet.lastModified || Date.now()
                    }))
                ]
            };

            // Write to backup file
            await fs.promises.writeFile(backupPath, JSON.stringify(backupData, null, 2));
            console.log('[DEBUG] Backup file updated successfully with data:', backupData);

            // Verify the backup was written correctly
            try {
                const verifyContent = await fs.promises.readFile(backupPath, 'utf8');
                const verifyData = JSON.parse(verifyContent);
                console.log('[DEBUG] Verified backup file content:', {
                    version: verifyData.version,
                    timestamp: verifyData.timestamp,
                    itemCount: verifyData.data.length,
                    path: backupPath
                });
            } catch (verifyError) {
                console.error('[DEBUG] Error verifying backup file:', verifyError);
            }
        } catch (error) {
            console.error('[DEBUG] Failed to update backup file:', error);
            // Show error to user since this is important for sync
            vscode.window.showErrorMessage(`Failed to update backup file: ${error}`);
        }
    }

    async syncData(data: { folders: Folder[]; snippets: Snippet[] }): Promise<void> {
        console.log('[DEBUG] Starting data sync with:', {
            folders: data.folders.length,
            snippets: data.snippets.length,
            folderDetails: data.folders,
            snippetDetails: data.snippets
        });
        await this.waitForInitialization();
        await this.saveFoldersData(data.folders);
        await this.saveSnippetsData(data.snippets);
        
        // Update backup file after successful save
        await this.updateBackupFile(data);
        
        console.log('[DEBUG] Data sync completed');
    }

    async renameFolder(folderId: string, newName: string): Promise<void> {
        const folders = await this.getFoldersData();
        const folderIndex = folders.findIndex(f => f.id === folderId);
        
        if (folderIndex !== -1) {
            folders[folderIndex] = {
                ...folders[folderIndex],
                name: newName,
                lastModified: Date.now()
            };
            await this.saveFoldersData(folders);
            await this.updateBackupFile({ folders, snippets: await this.getSnippetsData() });
        }
    }

    async renameSnippet(snippetId: string, newName: string): Promise<void> {
        const snippets = await this.getSnippetsData();
        const snippetIndex = snippets.findIndex(s => s.id === snippetId);
        
        if (snippetIndex !== -1) {
            snippets[snippetIndex] = {
                ...snippets[snippetIndex],
                name: newName,
                lastModified: Date.now()
            };
            await this.saveSnippetsData(snippets);
            await this.updateBackupFile({ folders: await this.getFoldersData(), snippets });
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
                        name: folder.name,
                        type: folder.type,
                        parentId: folder.parentId,
                        lastModified: folder.lastModified || Date.now()
                    })),
                    snippets: data.snippets.map(snippet => ({
                        id: snippet.id,
                        name: snippet.name,
                        code: snippet.code,
                        notes: snippet.notes || "",
                        folderId: snippet.folderId,
                        language: snippet.language || "plaintext",
                        lastModified: snippet.lastModified || Date.now()
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
                if (!folder.id || typeof folder.id !== 'string' || 
                    !folder.name || typeof folder.name !== 'string' ||
                    !folder.type || (folder.type !== 'primary' && folder.type !== 'secondary') ||
                    (folder.parentId !== null && typeof folder.parentId !== 'string')) {
                    throw new Error(`Invalid folder data at index ${index}`);
                }
                // Ensure lastModified exists
                if (!folder.lastModified) {
                    folder.lastModified = Date.now();
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
                // Ensure lastModified exists
                if (!snippet.lastModified) {
                    snippet.lastModified = Date.now();
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
                mergedFolders.set(id, {
                    ...folder,
                    lastModified: folder.lastModified || Date.now()
                });
            });

            // Add/update imported folders
            folders.forEach((folder: Folder) => {
                const existingFolder = mergedFolders.get(folder.id);
                if (!existingFolder || (folder.lastModified > existingFolder.lastModified)) {
                    mergedFolders.set(folder.id, {
                        ...folder,
                        lastModified: folder.lastModified
                    });
                }
            });

            // Merge snippets
            const mergedSnippets = new Map<string, Snippet>();
            
            // Add existing snippets
            existingSnippets.forEach((snippet, id) => {
                mergedSnippets.set(id, {
                    ...snippet,
                    lastModified: snippet.lastModified || Date.now()
                });
            });

            // Add/update imported snippets
            snippets.forEach((snippet: Snippet) => {
                const existingSnippet = mergedSnippets.get(snippet.id);
                if (!existingSnippet || (snippet.lastModified > existingSnippet.lastModified)) {
                    mergedSnippets.set(snippet.id, {
                        ...snippet,
                        lastModified: snippet.lastModified
                    });
                }
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

    async updateFolderParent(folderId: string, newParentId: string | null): Promise<void> {
        await this.waitForInitialization();
        const folders = await this.getFoldersData();
        const updatedFolders = folders.map(folder => {
            if (folder.id === folderId) {
                return { ...folder, parentId: newParentId, lastModified: Date.now() };
            }
            return folder;
        });
        await this.saveFoldersData(updatedFolders);
        await this.updateBackupFile({ folders: updatedFolders, snippets: await this.getSnippetsData() });
    }
} 