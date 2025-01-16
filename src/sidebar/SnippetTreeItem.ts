import * as vscode from 'vscode';

export class SnippetTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly id: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'folder' | 'snippet'
    ) {
        super(label, collapsibleState);
        this.contextValue = type;
        this.iconPath = type === 'folder' 
            ? new vscode.ThemeIcon('folder')
            : new vscode.ThemeIcon('code');

        if (type === 'snippet') {
            console.log('Creating snippet item:', this.label, this.id);
            this.command = {
                command: 'snippets.openSnippet',
                title: 'Open Snippet',
                arguments: [this]
            };
        }
    }
} 