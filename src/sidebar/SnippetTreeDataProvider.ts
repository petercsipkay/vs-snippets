import * as vscode from 'vscode';
import { LocalStorage } from '../storage/LocalStorage';
import { SnippetTreeItem } from './SnippetTreeItem';
import { Folder, Snippet } from '../storage/types';

export class SnippetTreeDataProvider implements vscode.TreeDataProvider<SnippetTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SnippetTreeItem | undefined> = new vscode.EventEmitter<SnippetTreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<SnippetTreeItem | undefined> = this._onDidChangeTreeData.event;
    private searchQuery: string = '';
    private folders: Folder[] = [];
    private snippets: Snippet[] = [];
    private isLoading: boolean = false;

    constructor(private localStorage: LocalStorage) {
        this.loadData().catch(error => {
            console.error('[DEBUG] Error in initial load:', error);
        });
    }

    dispose() {
        this._onDidChangeTreeData.dispose();
    }

    private async loadData(): Promise<void> {
        if (this.isLoading) {
            console.log('[DEBUG] Already loading data, skipping');
            return;
        }

        this.isLoading = true;
        try {
            console.log('[DEBUG] Loading tree data');
            const data = await this.localStorage.getAllData();
            this.folders = data.folders;
            this.snippets = data.snippets;
            console.log('[DEBUG] Loaded data:', {
                folders: this.folders.length,
                snippets: this.snippets.length,
                folderIds: this.folders.map(f => f.id),
                snippetIds: this.snippets.map(s => s.id)
            });
        } catch (error) {
            console.error('[DEBUG] Error loading data:', error);
            throw error;
        } finally {
            this.isLoading = false;
        }
    }

    async refresh(): Promise<void> {
        console.log('[DEBUG] Starting tree view refresh');
        try {
            await this.loadData();
            console.log('[DEBUG] Data loaded, firing refresh event');
            this._onDidChangeTreeData.fire(undefined);
            console.log('[DEBUG] Tree view refresh complete');
        } catch (error) {
            console.error('[DEBUG] Error during refresh:', error);
            throw error;
        }
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
                const rootFolders = this.folders.filter(folder => folder.parentId === null);
                
                // If searching, also show matching snippets at root level
                if (this.searchQuery) {
                    const matchingSnippets = this.snippets.filter(snippet => this.snippetMatchesSearch(snippet));

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
                const subfolders = this.folders.filter(folder => folder.parentId === element.id);
                const folderSnippets = this.snippets.filter(snippet => snippet.folderId === element.id);

                return [
                    ...subfolders.map(folder => new SnippetTreeItem(
                        folder.name,
                        folder.id,
                        'folder',
                        folder.parentId
                    )),
                    ...folderSnippets.map(snippet => new SnippetTreeItem(
                        snippet.name,
                        snippet.id,
                        'snippet',
                        snippet.folderId,
                        snippet.language
                    ))
                ];
            }

            return [];
        } catch (error) {
            console.error('[DEBUG] Error getting children:', error);
            return [];
        }
    }
} 