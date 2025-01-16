import * as vscode from 'vscode';

export class SnippetTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly id: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'folder' | 'snippet',
        public readonly language?: string
    ) {
        super(label, collapsibleState);

        if (type === 'folder') {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else {
            // For snippets, use language-specific file icons
            if (language) {
                // Map common language IDs to file extensions
                const extensionMap: { [key: string]: string } = {
                    'javascript': '.js',
                    'typescript': '.ts',
                    'python': '.py',
                    'java': '.java',
                    'csharp': '.cs',
                    'cpp': '.cpp',
                    'c': '.c',
                    'ruby': '.rb',
                    'php': '.php',
                    'html': '.html',
                    'css': '.css',
                    'go': '.go',
                    'rust': '.rs',
                    'swift': '.swift',
                    'kotlin': '.kt',
                    'markdown': '.md',
                    'json': '.json',
                    'xml': '.xml',
                    'yaml': '.yaml',
                    'shell': '.sh',
                    'sql': '.sql',
                    'dockerfile': 'Dockerfile',
                };

                const extension = extensionMap[language.toLowerCase()] || '.txt';
                this.resourceUri = vscode.Uri.parse(`file:///dummy/file${extension}`);
            } else {
                this.iconPath = new vscode.ThemeIcon('symbol-snippet');
            }
        }

        this.contextValue = type;
    }
} 