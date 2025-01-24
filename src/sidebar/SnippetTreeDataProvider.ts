import * as vscode from 'vscode';
import { LocalStorage } from '../storage/LocalStorage';
import { SnippetTreeItem } from './SnippetTreeItem';
import { Folder, Snippet } from '../storage/types';

export class SnippetTreeDataProvider implements vscode.TreeDataProvider<SnippetTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SnippetTreeItem | undefined> = new vscode.EventEmitter<SnippetTreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<SnippetTreeItem | undefined> = this._onDidChangeTreeData.event;
    private searchQuery: string = '';

    constructor(private localStorage: LocalStorage) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    setSearchQuery(query: string): void {
        this.searchQuery = query.toLowerCase();
        // Update context to show/hide clear search button
        vscode.commands.executeCommand('setContext', 'snippets:hasSearchQuery', !!query);
        this.refresh();
    }

    clearSearch(): void {
        this.searchQuery = '';
        vscode.commands.executeCommand('setContext', 'snippets:hasSearchQuery', false);
        this.refresh();
    }

    getTreeItem(element: SnippetTreeItem): vscode.TreeItem {
        return element;
    }

    // Handle drag and drop
    async handleDrop(target: SnippetTreeItem, sources: vscode.DataTransfer): Promise<void> {
        const snippetData = sources.get('application/vnd.code.tree.snippetsExplorer');
        if (!snippetData) {
            return;
        }

        const sourceItem = JSON.parse(snippetData.value) as SnippetTreeItem;
        if (sourceItem.type !== 'snippet' || target.type !== 'folder') {
            return;
        }

        // Don't move if the target is the same as the current parent
        if (sourceItem.parentId === target.id) {
            return;
        }

        try {
            const snippet = await this.localStorage.getSnippet(sourceItem.id);
            if (snippet) {
                await this.localStorage.updateSnippet({
                    id: snippet.id,
                    folderId: target.id
                });
                this.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage('Failed to move snippet: ' + error);
        }
    }

    // Handle drag
    async handleDrag(source: SnippetTreeItem[], dataTransfer: vscode.DataTransfer): Promise<void> {
        if (source.length === 1 && source[0].type === 'snippet') {
            dataTransfer.set('application/vnd.code.tree.snippetsExplorer', new vscode.DataTransferItem(JSON.stringify(source[0])));
        }
    }

    private snippetMatchesSearch(snippet: Snippet): boolean {
        if (!this.searchQuery) {
            return true;
        }
        
        const searchTerms = this.searchQuery.toLowerCase().split(' ');
        
        return searchTerms.every(term => {
            // Check name match
            if (snippet.name.toLowerCase().includes(term)) {
                return true;
            }

            // Check tags match
            if (snippet.tags && snippet.tags.some(tag => tag.toLowerCase().includes(term))) {
                return true;
            }

            // Check notes match
            if (snippet.notes && snippet.notes.toLowerCase().includes(term)) {
                return true;
            }

            // Check code content match
            if (snippet.code && snippet.code.toLowerCase().includes(term)) {
                return true;
            }

            return false;
        });
    }

    private folderMatchesSearch(folder: Folder): boolean {
        if (!this.searchQuery) {
            return true;
        }
        return folder.name.toLowerCase().includes(this.searchQuery.toLowerCase());
    }

    async getChildren(element?: SnippetTreeItem): Promise<SnippetTreeItem[]> {
        try {
            if (!element) {
                // Root level - show only root folders
                const folders = await this.localStorage.getFolders();
                const rootFolders = folders.filter(folder => folder.parentId === null);
                
                // If searching, also show matching snippets at root level
                if (this.searchQuery) {
                    const snippets = await this.localStorage.getSnippets();
                    const matchingSnippets = snippets.filter(snippet => this.snippetMatchesSearch(snippet));

                    return [
                        ...rootFolders
                            .filter(folder => this.folderMatchesSearch(folder))
                            .map(folder => new SnippetTreeItem(
                                folder.name,
                                folder.id,
                                'folder',
                                null
                            )),
                        ...matchingSnippets.map(snippet => new SnippetTreeItem(
                            snippet.name,
                            snippet.id,
                            'snippet',
                            snippet.folderId,
                            snippet.language
                        ))
                    ];
                }

                return rootFolders.map(folder => new SnippetTreeItem(
                    folder.name,
                    folder.id,
                    'folder',
                    null
                ));
            } else if (element.type === 'folder') {
                // Folder level - show subfolders and snippets
                const [folders, snippets] = await Promise.all([
                    this.localStorage.getFolders(),
                    this.localStorage.getSnippets()
                ]);

                // Get subfolders of current folder
                const subFolders = folders
                    .filter(folder => folder.parentId === element.id)
                    .filter(folder => this.folderMatchesSearch(folder))
                    .map(folder => new SnippetTreeItem(
                        folder.name,
                        folder.id,
                        'folder',
                        folder.parentId
                    ));

                // Get snippets in current folder
                const folderSnippets = snippets
                    .filter(snippet => snippet.folderId === element.id)
                    .filter(snippet => this.snippetMatchesSearch(snippet))
                    .map(snippet => new SnippetTreeItem(
                        snippet.name,
                        snippet.id,
                        'snippet',
                        element.id,
                        snippet.language
                    ));

                // Return subfolders first, then snippets
                return [...subFolders, ...folderSnippets];
            }

            return [];
        } catch (error) {
            console.error('Error getting children:', error);
            return [];
        }
    }
} 