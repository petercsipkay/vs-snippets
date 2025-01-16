import * as vscode from 'vscode';
import { SnippetTreeItem } from './SnippetTreeItem';
import { LocalStorage } from '../storage/LocalStorage';
import { GistStorage } from '../storage/GistStorage';

export class SnippetTreeDataProvider implements vscode.TreeDataProvider<SnippetTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SnippetTreeItem | undefined | null | void> = new vscode.EventEmitter<SnippetTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SnippetTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(
        private localStorage: LocalStorage,
        // Keep gistStorage for future use in sync operations
        // @ts-ignore - Will be used in future sync operations
        private gistStorage: GistStorage
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SnippetTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SnippetTreeItem): Promise<SnippetTreeItem[]> {
        if (!element) {
            // Root level - show folders
            const folders = await this.localStorage.getFolders();
            return folders.map(folder => new SnippetTreeItem(
                folder.name,
                folder.id,
                vscode.TreeItemCollapsibleState.Collapsed,
                'folder'
            ));
        } else if (element.type === 'folder') {
            // Folder level - show snippets
            const snippets = await this.localStorage.getSnippets(element.id);
            return snippets.map(snippet => new SnippetTreeItem(
                snippet.name,
                snippet.id,
                vscode.TreeItemCollapsibleState.None,
                'snippet'
            ));
        }
        return [];
    }
} 