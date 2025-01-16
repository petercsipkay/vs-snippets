import * as vscode from 'vscode';
import { SnippetTreeItem } from './SnippetTreeItem';
import { LocalStorage } from '../storage/LocalStorage';
import { GistStorage } from '../storage/GistStorage';

export class SnippetTreeDataProvider implements vscode.TreeDataProvider<SnippetTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SnippetTreeItem | undefined | null | void> = new vscode.EventEmitter<SnippetTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SnippetTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private searchQuery: string = '';

    constructor(
        private localStorage: LocalStorage,
        // Keep gistStorage for future use in sync operations
        // @ts-ignore - Will be used in future sync operations
        private gistStorage: GistStorage
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    setSearchQuery(query: string): void {
        this.searchQuery = query.toLowerCase();
        this.refresh();
    }

    getTreeItem(element: SnippetTreeItem): vscode.TreeItem {
        return element;
    }

    private snippetMatchesSearch(snippet: { name: string, tags?: string[] }): boolean {
        if (!this.searchQuery) return true;
        
        // Check name match
        if (snippet.name.toLowerCase().includes(this.searchQuery)) {
            return true;
        }

        // Check tags match
        if (snippet.tags && snippet.tags.some(tag => tag.toLowerCase().includes(this.searchQuery))) {
            return true;
        }

        return false;
    }

    async getChildren(element?: SnippetTreeItem): Promise<SnippetTreeItem[]> {
        if (!element) {
            // Root level
            if (this.searchQuery) {
                // When searching, show matching snippets directly
                const allSnippets = await this.localStorage.getAllSnippets();
                const matchingSnippets = allSnippets.filter(snippet => this.snippetMatchesSearch(snippet));
                
                // Create tree items for matching snippets with folder info
                const items: SnippetTreeItem[] = [];
                const folders = await this.localStorage.getFolders();
                
                for (const snippet of matchingSnippets) {
                    const folder = folders.find(f => f.id === snippet.folderId);
                    const folderName = folder ? folder.name : 'Unknown Folder';
                    const item = new SnippetTreeItem(
                        `${snippet.name} (${folderName})`,
                        snippet.id,
                        vscode.TreeItemCollapsibleState.None,
                        'snippet',
                        snippet.language
                    );
                    item.command = {
                        command: 'snippets.openSnippet',
                        title: 'Open Snippet',
                        arguments: [item]
                    };
                    items.push(item);
                }
                
                return items;
            } else {
                // Normal view - show folders
                const folders = await this.localStorage.getFolders();
                return folders.map(folder => new SnippetTreeItem(
                    folder.name,
                    folder.id,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'folder'
                ));
            }
        } else if (element.type === 'folder') {
            // Folder level - show snippets
            const snippets = await this.localStorage.getSnippets(element.id);
            return snippets.map(snippet => {
                const item = new SnippetTreeItem(
                    snippet.name,
                    snippet.id,
                    vscode.TreeItemCollapsibleState.None,
                    'snippet',
                    snippet.language
                );
                item.command = {
                    command: 'snippets.openSnippet',
                    title: 'Open Snippet',
                    arguments: [item]
                };
                return item;
            });
        }
        return [];
    }
} 