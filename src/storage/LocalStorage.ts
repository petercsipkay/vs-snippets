import * as vscode from 'vscode';

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
    constructor(private storage: vscode.Memento) {}

    private async getFoldersData(): Promise<Folder[]> {
        return this.storage.get('folders', []);
    }

    private async getSnippetsData(): Promise<Snippet[]> {
        return this.storage.get('snippets', []);
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
        await this.storage.update('folders', folders);
    }

    async addSnippet(snippet: Partial<Snippet>): Promise<void> {
        const snippets = await this.getSnippetsData();
        snippets.push({
            ...snippet,
            id: Date.now().toString()
        } as Snippet);
        await this.storage.update('snippets', snippets);
    }

    async deleteFolder(folderId: string): Promise<void> {
        const folders = await this.getFoldersData();
        const snippets = await this.getSnippetsData();
        
        // Remove folder
        const updatedFolders = folders.filter(f => f.id !== folderId);
        await this.storage.update('folders', updatedFolders);
        
        // Remove all snippets in the folder
        const updatedSnippets = snippets.filter(s => s.folderId !== folderId);
        await this.storage.update('snippets', updatedSnippets);
    }

    async deleteSnippet(snippetId: string): Promise<void> {
        const snippets = await this.getSnippetsData();
        const updatedSnippets = snippets.filter(s => s.id !== snippetId);
        await this.storage.update('snippets', updatedSnippets);
    }

    async updateSnippet(update: SnippetUpdate): Promise<void> {
        const snippets = await this.getSnippetsData();
        const snippetIndex = snippets.findIndex(s => s.id === update.id);
        
        if (snippetIndex !== -1) {
            snippets[snippetIndex] = {
                ...snippets[snippetIndex],
                ...update
            };
            await this.storage.update('snippets', snippets);
        }
    }

    async getSnippet(snippetId: string): Promise<Snippet | undefined> {
        const snippets = await this.getSnippetsData();
        return snippets.find(s => s.id === snippetId);
    }

    // Public methods for syncing
    async getAllData(): Promise<{ folders: Folder[]; snippets: Snippet[] }> {
        return {
            folders: await this.getFoldersData(),
            snippets: await this.getSnippetsData()
        };
    }

    async syncData(data: { folders: Folder[]; snippets: Snippet[] }): Promise<void> {
        await this.storage.update('folders', data.folders);
        await this.storage.update('snippets', data.snippets);
    }

    async renameFolder(folderId: string, newName: string): Promise<void> {
        const folders = await this.getFoldersData();
        const folderIndex = folders.findIndex(f => f.id === folderId);
        
        if (folderIndex !== -1) {
            folders[folderIndex].name = newName;
            await this.storage.update('folders', folders);
        }
    }

    async renameSnippet(snippetId: string, newName: string): Promise<void> {
        const snippets = await this.getSnippetsData();
        const snippetIndex = snippets.findIndex(s => s.id === snippetId);
        
        if (snippetIndex !== -1) {
            snippets[snippetIndex].name = newName;
            await this.storage.update('snippets', snippets);
        }
    }
} 