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
        // Always use Collapsed state for folders
        const collapsibleState = type === 'folder' 
            ? vscode.TreeItemCollapsibleState.Collapsed
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
            // Web Development
            'javascript': 'js',
            'typescript': 'ts',
            'jsx': 'jsx',
            'tsx': 'tsx',
            'html': 'html',
            'css': 'css',
            'scss': 'scss',
            'sass': 'sass',
            'less': 'less',
            'postcss': 'pcss',
            'tailwindcss': 'css',

            // Web Frameworks
            'react': 'jsx',
            'reactts': 'tsx',
            'vue': 'vue',
            'svelte': 'svelte',
            'angular': 'ts',
            'astro': 'astro',
            'solid': 'jsx',
            'nextjs': 'tsx',
            'nuxt': 'vue',

            // Programming Languages
            'python': 'py',
            'java': 'java',
            'csharp': 'cs',
            'cpp': 'cpp',
            'c': 'c',
            'go': 'go',
            'rust': 'rs',
            'php': 'php',
            'ruby': 'rb',
            'kotlin': 'kt',
            'swift': 'swift',
            'dart': 'dart',
            'r': 'r',
            'perl': 'pl',
            'lua': 'lua',
            'scala': 'scala',

            // Data & Config
            'json': 'json',
            'xml': 'xml',
            'yaml': 'yml',
            'toml': 'toml',
            'ini': 'ini',
            'env': 'env',
            'graphql': 'graphql',
            'markdown': 'md',
            'latex': 'tex',

            // Shell & Scripting
            'shell': 'sh',
            'bash': 'sh',
            'powershell': 'ps1',
            'batch': 'bat',

            // Database
            'sql': 'sql',
            'plsql': 'sql',
            'mongodb': 'mongodb',

            // Build Tools
            'dockerfile': 'dockerfile',
            'docker-compose': 'yml',
            'makefile': 'mk',
            'cmake': 'cmake',
            'gradle': 'gradle',
            'webpack': 'js',
            'rollup': 'js',
            'vite': 'js',

            // Default
            'plaintext': 'txt'
        };

        // Convert language to lowercase for case-insensitive matching
        const lang = language.toLowerCase();

        // Special handling for React/TypeScript combinations
        if (lang === 'react' && language.includes('TypeScript')) {
            return 'tsx';
        }

        return extensionMap[lang] || 'txt';
    }
} 