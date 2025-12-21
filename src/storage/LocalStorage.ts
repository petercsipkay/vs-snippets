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

        const data = await fs.promises.readFile(foldersPath, 'utf8');

        const folders = JSON.parse(data);

        return folders;
    }

    private async getSnippetsData(): Promise<Snippet[]> {
        await this.waitForInitialization();
        const snippetsPath = path.join(this.storagePath, 'snippets.json');


        try {
            const data = await fs.promises.readFile(snippetsPath, 'utf8');


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



            return sanitizedSnippets;
        } catch (error) {
            console.error('[DEBUG] Error reading snippets:', error);
            throw error;
        }
    }

    private async saveFoldersData(folders: Folder[]): Promise<void> {
        await this.waitForInitialization();

        const foldersPath = path.join(this.storagePath, 'folders.json');
        await fs.promises.writeFile(foldersPath, JSON.stringify(folders, null, 2));


        // Verify the file was written correctly
        try {
            const savedContent = await fs.promises.readFile(foldersPath, 'utf8');
            const savedFolders = JSON.parse(savedContent);

        } catch (error) {
            console.error('[DEBUG] Error verifying folders file:', error);
        }
    }

    private async saveSnippetsData(snippets: Snippet[]): Promise<void> {
        await this.waitForInitialization();


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



        await fs.promises.writeFile(snippetsPath, snippetsJson);


        // Verify the file was written correctly
        try {
            const savedContent = await fs.promises.readFile(snippetsPath, 'utf8');
            const savedSnippets = JSON.parse(savedContent);

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

    async addFolder(name: string, parentId: string | null = null): Promise<void> {
        const folders = await this.getFoldersData();

        // Get max order of siblings
        const siblings = folders.filter(f => f.parentId === parentId);
        const maxOrder = Math.max(...siblings.map(f => f.order || 0), -1);

        const newFolder: Folder = {
            id: Date.now().toString(),
            name,
            parentId,
            type: 'primary',
            lastModified: Date.now(),
            order: maxOrder + 1
        };

        folders.push(newFolder);
        await this.saveFoldersData(folders);
        await this.updateBackupFile({ folders, snippets: await this.getSnippetsData() });
    }

    async addSnippet(snippet: Omit<Snippet, 'id' | 'lastModified'>): Promise<Snippet> {
        await this.waitForInitialization();


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



        const snippets = await this.getSnippets();
        snippets.push(newSnippet);

        // Save the updated snippets array
        await this.saveSnippetsData(snippets);

        // Update the backup file
        await this.updateBackupFile({
            folders: await this.getFoldersData(),
            snippets
        });


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




            // Replace the old snippet with the updated one
            snippets[snippetIndex] = updatedSnippet;

            // Save the updated snippets array
            await this.saveSnippetsData(snippets);

            // Update the backup file
            await this.updateBackupFile({
                folders: await this.getFoldersData(),
                snippets
            });


        } else {
            console.error('Snippet not found:', update.id);
            throw new Error('Snippet not found');
        }
    }

    async getSnippet(snippetId: string): Promise<Snippet | undefined> {
        const snippets = await this.getSnippetsData();
        return snippets.find(s => s.id === snippetId);
    }

    async getAllData(): Promise<{ folders: Folder[]; snippets: Snippet[] }> {

        const data = {
            folders: await this.getFoldersData(),
            snippets: await this.getSnippetsData()
        };
        return data;
    }

    private async updateBackupFile(data: { folders: Folder[]; snippets: Snippet[] }): Promise<void> {
        const backupFolder = vscode.workspace.getConfiguration('snippets').get<string>('backupFolder');
        if (!backupFolder) {
            console.log('No backup folder configured, skipping backup update');
            return;
        }

        try {
            // Create backup folder if it doesn't exist
            await fs.promises.mkdir(backupFolder, { recursive: true });
            const backupPath = path.join(backupFolder, 'snippets.json');


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


            // Verify the backup was written correctly
            try {
                const verifyContent = await fs.promises.readFile(backupPath, 'utf8');
                const verifyData = JSON.parse(verifyContent);

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

        await this.waitForInitialization();
        await this.saveFoldersData(data.folders);
        await this.saveSnippetsData(data.snippets);

        // Update backup file after successful save
        await this.updateBackupFile(data);


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

    async moveFolder(sourcePath: string, targetPath: string): Promise<void> {
        try {
            // Get current data
            const data = await this.getAllData();

            // Find the folder to move
            const folderToMove = data.folders.find(f => f.id === sourcePath);
            if (!folderToMove) {
                throw new Error('Source folder not found');
            }

            // Update the folder's parent ID
            if (targetPath === '') {
                // Moving to root
                folderToMove.parentId = null;
            } else {
                // Moving to another folder
                folderToMove.parentId = targetPath;
            }

            // Update last modified timestamp
            folderToMove.lastModified = Date.now();

            // Save the updated data
            await this.syncData({
                folders: data.folders,
                snippets: data.snippets
            });
        } catch (error) {
            throw new Error(`Failed to move folder: ${error}`);
        }
    }

    async updateFolderOrder(folderId: string, direction: 'up' | 'down'): Promise<void> {
        try {
            const folders = await this.getFoldersData();

            // Get current folder
            const currentFolder = folders.find(f => f.id === folderId);
            if (!currentFolder) {
                throw new Error('Folder not found');
            }

            // Get siblings (folders with same parent)
            const siblings = folders
                .filter(f => f.parentId === currentFolder.parentId)
                .sort((a, b) => (a.order || 0) - (b.order || 0));

            const currentIndex = siblings.findIndex(f => f.id === folderId);
            if (currentIndex === -1) {
                throw new Error('Current folder not found in siblings');
            }

            // Calculate target index
            const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
            if (targetIndex < 0 || targetIndex >= siblings.length) {
                return; // Can't move further
            }

            // Get target folder
            const targetFolder = siblings[targetIndex];

            // If folders don't have order yet, initialize them
            if (currentFolder.order === undefined) {
                // Initialize orders for all siblings if they don't exist
                siblings.forEach((folder, index) => {
                    folder.order = index * 100; // Use multiples of 100 to leave room for insertions
                });
            }

            // Swap orders
            const tempOrder = currentFolder.order;
            currentFolder.order = targetFolder.order;
            targetFolder.order = tempOrder;

            // Update the folders in the main array
            folders.forEach(folder => {
                if (folder.id === currentFolder.id) {
                    folder.order = currentFolder.order;
                } else if (folder.id === targetFolder.id) {
                    folder.order = targetFolder.order;
                }
            });

            // Save the updated folders
            await this.saveFoldersData(folders);

            // Update backup if needed
            await this.updateBackupFile({
                folders,
                snippets: await this.getSnippetsData()
            });
        } catch (error) {
            console.error('Error updating folder order:', error);
            throw new Error(`Failed to update folder order: ${error}`);
        }
    }
} 