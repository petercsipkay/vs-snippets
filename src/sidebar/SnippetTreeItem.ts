import * as vscode from 'vscode';
import * as path from 'path';
import { Folder, Snippet } from '../storage/types';

export class SnippetTreeItem extends vscode.TreeItem {
    public readonly draggable: boolean;
    public readonly dropTarget: boolean;

    constructor(
        public readonly label: string,
        public readonly id: string,
        public readonly type: 'folder' | 'snippet',
        public readonly parentId: string | null = null,
        public readonly language?: string
    ) {
        // For folders, use Collapsed state if it has a parentId (subfolder), otherwise Expanded (root folder)
        const collapsibleState = type === 'folder' 
            ? (parentId === null ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
            : vscode.TreeItemCollapsibleState.None;

        super(label, collapsibleState);

        this.tooltip = type === 'folder' ? `Folder: ${label}` : label;
        this.contextValue = type;

        // Enable drag for snippets and drop for folders
        this.draggable = type === 'snippet';
        this.dropTarget = type === 'folder';

        if (type === 'folder') {
            // Use different icons for root folders and subfolders
            this.iconPath = new vscode.ThemeIcon(parentId === null ? 'folder' : 'folder-opened');
        } else {
            // Create a fake file path with the correct extension to get proper file icon
            const extension = this.getLanguageExtension(language || 'plaintext');
            this.resourceUri = vscode.Uri.parse(`file:///fake/path/file.${extension}`);
            
            // Only pass the necessary properties to avoid circular reference
            this.command = {
                command: 'snippets.openSnippet',
                title: 'Open Snippet',
                arguments: [{
                    id: this.id,
                    name: this.label,
                    type: this.type,
                    language: this.language
                }]
            };
        }
    }

    private getLanguageExtension(language: string): string {
        // Map of languages to their file extensions
        const extensionMap: { [key: string]: string } = {
            'javascript': 'js',
            'typescript': 'ts',
            'python': 'py',
            'java': 'java',
            'csharp': 'cs',
            'cpp': 'cpp',
            'c': 'c',
            'go': 'go',
            'rust': 'rs',
            'php': 'php',
            'ruby': 'rb',
            'html': 'html',
            'css': 'css',
            'scss': 'scss',
            'sass': 'sass',
            'less': 'less',
            'json': 'json',
            'xml': 'xml',
            'yaml': 'yml',
            'markdown': 'md',
            'shell': 'sh',
            'bash': 'sh',
            'powershell': 'ps1',
            'sql': 'sql',
            'dockerfile': 'dockerfile',
            'plaintext': 'txt'
        };

        return extensionMap[language.toLowerCase()] || 'txt';
    }
} 