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

        // Set the contextValue to match the type for menu contributions
        this.contextValue = type;

        // Set tooltip
        this.tooltip = type === 'folder' ? `Folder: ${label}` : label;

        // For snippets, set up the open command
        if (type === 'snippet') {
            this.command = {
                command: 'snippets.openSnippet',
                title: 'Open Snippet',
                arguments: [this]
            };
        }

        // Set icon based on type
        if (type === 'folder') {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else {
            // For snippets, use language-specific file icons
            if (language) {
                // Map common language IDs to file extensions
                const extensionMap: { [key: string]: string } = {
                    // Web languages
                    'javascript': '.js',
                    'typescript': '.ts',
                    'html': '.html',
                    'css': '.css',
                    'scss': '.scss',
                    'sass': '.sass',
                    'less': '.less',
                    'postcss': '.css',
                    'tailwindcss': '.css',
                    'json': '.json',
                    'xml': '.xml',
                    'yaml': '.yaml',
                    'markdown': '.md',
                    
                    // Programming languages
                    'python': '.py',
                    'java': '.java',
                    'csharp': '.cs',
                    'cpp': '.cpp',
                    'c': '.c',
                    'ruby': '.rb',
                    'php': '.php',
                    'go': '.go',
                    'rust': '.rs',
                    'swift': '.swift',
                    'kotlin': '.kt',
                    'dart': '.dart',
                    'r': '.r',
                    'perl': '.pl',
                    'lua': '.lua',
                    'scala': '.scala',
                    
                    // Shell and scripting
                    'shell': '.sh',
                    'bash': '.sh',
                    'zsh': '.sh',
                    'powershell': '.ps1',
                    'batch': '.bat',
                    
                    // Database
                    'sql': '.sql',
                    'plsql': '.sql',
                    'mongodb': '.mongodb',
                    
                    // Config and build
                    'dockerfile': 'Dockerfile',
                    'docker-compose': 'docker-compose.yml',
                    'makefile': 'Makefile',
                    'toml': '.toml',
                    'ini': '.ini',
                    'env': '.env',
                    
                    // Web frameworks
                    'vue': '.vue',
                    'react': '.jsx',
                    'svelte': '.svelte',
                    'angular': '.ts',
                    'astro': '.astro',
                    
                    // Template languages
                    'handlebars': '.hbs',
                    'ejs': '.ejs',
                    'pug': '.pug',
                    'nunjucks': '.njk',
                    
                    // Other
                    'regex': '.regex',
                    'graphql': '.graphql',
                    'latex': '.tex',
                    'plaintext': '.txt'
                };

                // Normalize language ID and handle special cases
                const normalizedLang = language.toLowerCase().replace(/\s+/g, '');
                
                // Handle CSS variants
                if (normalizedLang.includes('css')) {
                    this.resourceUri = vscode.Uri.parse('file:///dummy/file.css');
                } else {
                    const extension = extensionMap[normalizedLang] || '.txt';
                    this.resourceUri = vscode.Uri.parse(`file:///dummy/file${extension}`);
                }
                
                this.tooltip = `${label} (${language})`;
            } else {
                this.iconPath = new vscode.ThemeIcon('symbol-snippet');
            }
        }
    }
} 