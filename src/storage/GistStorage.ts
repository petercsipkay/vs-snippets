import * as vscode from 'vscode';
import axios from 'axios';
import { Folder } from './types';
import { Snippet } from './types';

interface GistData {
    folders: Folder[];
    snippets: Snippet[];
}

interface SnippetGist {
    id: string;
    description: string;
    files: {
        [key: string]: {
            content: string;
        };
    };
}

export class GistStorage {
    private token: string | null = null;

    async configure(): Promise<void> {
        // Ask for GitHub token if not set
        const token = await vscode.window.showInputBox({
            prompt: 'Enter your GitHub Personal Access Token (make sure it has the gist scope)',
            password: true,
            placeHolder: 'ghp_...',
            validateInput: (value) => {
                if (!value) {
                    return 'Token is required';
                }
                if (!value.startsWith('ghp_')) {
                    return 'Token should start with "ghp_"';
                }
                return null;
            }
        });

        if (!token) {
            return;
        }

        // Verify token works before saving
        try {
            // Test the token with a simple API call
            await axios.get('https://api.github.com/user', {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `Bearer ${token}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                    'User-Agent': 'VS-Code-Snippets-Manager'
                }
            });

            this.token = token;
            await vscode.workspace.getConfiguration().update('snippets.githubToken', token, true);
            vscode.window.showInformationMessage('GitHub token configured successfully');
        } catch (error: any) {
            console.error('Token verification error:', error.response?.data || error);
            vscode.window.showErrorMessage(`Invalid GitHub token: ${error.response?.data?.message || error.message}`);
            return;
        }
    }

    async testConnection(): Promise<void> {
        if (!this.token) {
            const storedToken = await vscode.workspace.getConfiguration().get<string>('snippets.githubToken');
            if (!storedToken) {
                throw new Error('GitHub token not configured');
            }
            this.token = storedToken;
        }

        try {
            await axios.get('https://api.github.com/user', {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `Bearer ${this.token}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                    'User-Agent': 'VS-Code-Snippets-Manager'
                }
            });
        } catch (error: any) {
            throw new Error(error.response?.data?.message || error.message);
        }
    }

    private async getSnippetGistId(snippetId: string): Promise<string | null> {
        const config = vscode.workspace.getConfiguration('snippets');
        const gistMapping = await config.get<{ [key: string]: string }>('gistMapping') || {};
        return gistMapping[snippetId] || null;
    }

    private async saveSnippetGistId(snippetId: string, gistId: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('snippets');
        const gistMapping = { ...(await config.get<{ [key: string]: string }>('gistMapping') || {}) };
        gistMapping[snippetId] = gistId;
        await config.update('gistMapping', gistMapping, true);
    }

    private async removeGistMapping(snippetId: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('snippets');
        const gistMapping = { ...(await config.get<{ [key: string]: string }>('gistMapping') || {}) };
        delete gistMapping[snippetId];
        await config.update('gistMapping', gistMapping, true);
    }

    async deleteSnippetGist(snippetId: string): Promise<void> {
        if (!this.token) {
            const storedToken = await vscode.workspace.getConfiguration().get<string>('snippets.githubToken');
            if (!storedToken) {
                throw new Error('GitHub token not configured');
            }
            this.token = storedToken;
        }

        const gistId = await this.getSnippetGistId(snippetId);
        if (gistId) {
            try {
                await axios.delete(`https://api.github.com/gists/${gistId}`, {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'Authorization': `Bearer ${this.token}`,
                        'X-GitHub-Api-Version': '2022-11-28',
                        'User-Agent': 'VS-Code-Snippets-Manager'
                    }
                });
            } catch (error: any) {
                // If gist is already deleted (404) or other error, just remove the mapping
                console.log('Error deleting gist:', error.response?.status, error.response?.data);
            }
            // Remove the mapping regardless of whether delete succeeded
            await this.removeGistMapping(snippetId);
        }
    }

    async sync(localData: GistData): Promise<void> {
        if (!this.token) {
            const storedToken = await vscode.workspace.getConfiguration().get<string>('snippets.githubToken');
            if (!storedToken) {
                throw new Error('GitHub token not configured');
            }
            this.token = storedToken;
        }

        try {
            // Get all current mappings
            const config = vscode.workspace.getConfiguration('snippets');
            const gistMapping = { ...(await config.get<{ [key: string]: string }>('gistMapping') || {}) };
            
            // Find and remove mappings for deleted snippets
            const localSnippetIds = new Set(localData.snippets.map(s => s.id));
            for (const [snippetId, gistId] of Object.entries(gistMapping)) {
                if (!localSnippetIds.has(snippetId)) {
                    try {
                        await axios.delete(`https://api.github.com/gists/${gistId}`, {
                            headers: {
                                'Accept': 'application/vnd.github.v3+json',
                                'Authorization': `Bearer ${this.token}`,
                                'X-GitHub-Api-Version': '2022-11-28',
                                'User-Agent': 'VS-Code-Snippets-Manager'
                            }
                        });
                    } catch (error: any) {
                        // If gist is already deleted or other error, just continue
                        console.log('Error deleting gist:', error.response?.status, error.response?.data);
                    }
                    await this.removeGistMapping(snippetId);
                }
            }

            // Process each snippet
            for (const snippet of localData.snippets) {
                const gistId = await this.getSnippetGistId(snippet.id);
                const folder = localData.folders.find(f => f.id === snippet.folderId);
                const description = `VS Code Snippet: ${snippet.name} (${folder?.name || 'No Folder'})`;

                // Store all information in a single file with appropriate extension
                const fileName = snippet.name + (snippet.language ? '.' + snippet.language : '.txt');
                const content = `// Snippet Name: ${snippet.name}
// Folder: ${folder?.name || 'No Folder'}
// Language: ${snippet.language || 'plain text'}
// Notes: ${snippet.notes || 'No notes'}
// ID: ${snippet.id}
// Folder ID: ${snippet.folderId || 'none'}

${snippet.code}`;

                const gistContent = {
                    [fileName]: {
                        content: content
                    }
                };

                if (gistId) {
                    try {
                        // Update existing Gist
                        await axios.patch<SnippetGist>(`https://api.github.com/gists/${gistId}`, {
                            description,
                            files: gistContent
                        }, {
                            headers: {
                                'Accept': 'application/vnd.github.v3+json',
                                'Authorization': `Bearer ${this.token}`,
                                'X-GitHub-Api-Version': '2022-11-28',
                                'Content-Type': 'application/json',
                                'User-Agent': 'VS-Code-Snippets-Manager'
                            }
                        });
                    } catch (error: any) {
                        if (error.response?.status === 404) {
                            // Gist was deleted, remove mapping and create new gist
                            await this.removeGistMapping(snippet.id);
                            const response = await axios.post<SnippetGist>('https://api.github.com/gists', {
                                description,
                                public: false,
                                files: gistContent
                            }, {
                                headers: {
                                    'Accept': 'application/vnd.github.v3+json',
                                    'Authorization': `Bearer ${this.token}`,
                                    'X-GitHub-Api-Version': '2022-11-28',
                                    'Content-Type': 'application/json',
                                    'User-Agent': 'VS-Code-Snippets-Manager'
                                }
                            });
                            await this.saveSnippetGistId(snippet.id, response.data.id);
                        } else {
                            throw error;
                        }
                    }
                } else {
                    // Create new Gist
                    const response = await axios.post<SnippetGist>('https://api.github.com/gists', {
                        description,
                        public: false,
                        files: gistContent
                    }, {
                        headers: {
                            'Accept': 'application/vnd.github.v3+json',
                            'Authorization': `Bearer ${this.token}`,
                            'X-GitHub-Api-Version': '2022-11-28',
                            'Content-Type': 'application/json',
                            'User-Agent': 'VS-Code-Snippets-Manager'
                        }
                    });

                    // Save the mapping
                    await this.saveSnippetGistId(snippet.id, response.data.id);
                }
            }

            vscode.window.showInformationMessage('Successfully synced all snippets to GitHub Gists');
        } catch (error: any) {
            console.error('Detailed error:', error.response?.data || error);
            if (error.response) {
                throw new Error(`Failed to sync snippets: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else {
                throw new Error(`Failed to sync snippets: ${error.message}`);
            }
        }
    }

    async load(): Promise<GistData | null> {
        if (!this.token) {
            const storedToken = await vscode.workspace.getConfiguration().get<string>('snippets.githubToken');
            if (!storedToken) {
                return null;
            }
            this.token = storedToken;
        }

        try {
            const config = vscode.workspace.getConfiguration('snippets');
            const gistMapping = { ...(await config.get<{ [key: string]: string }>('gistMapping') || {}) };

            const folders = new Map<string, Folder>();
            const snippets: Snippet[] = [];

            // Load each snippet from its Gist
            for (const [snippetId, gistId] of Object.entries(gistMapping)) {
                const response = await axios.get<SnippetGist>(`https://api.github.com/gists/${gistId}`, {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'Authorization': `Bearer ${this.token}`,
                        'X-GitHub-Api-Version': '2022-11-28',
                        'User-Agent': 'VS-Code-Snippets-Manager'
                    }
                });

                // Get the first file from the gist
                const file = Object.values(response.data.files)[0];
                if (!file || !file.content) continue;

                const content = file.content;
                const lines = content.split('\n');
                
                // Parse metadata from comments
                const metadata = new Map<string, string>();
                let codeStartIndex = 0;
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line.startsWith('//')) {
                        const [key, value] = line.substring(2).split(':').map((s: string) => s.trim());
                        metadata.set(key, value);
                        codeStartIndex = i + 1;
                    } else {
                        break;
                    }
                }

                // Extract code (everything after the metadata)
                const code = lines.slice(codeStartIndex + 1).join('\n');

                const folderId = metadata.get('Folder ID')?.replace('none', '') || '';
                const folderName = metadata.get('Folder')?.replace('No Folder', '') || '';

                // Add folder if it doesn't exist and has valid data
                if (folderId && folderName && !folders.has(folderId)) {
                    folders.set(folderId, {
                        id: folderId,
                        name: folderName
                    });
                }

                snippets.push({
                    id: metadata.get('ID') || snippetId,
                    name: metadata.get('Snippet Name') || '',
                    code: code,
                    notes: metadata.get('Notes')?.replace('No notes', '') || '',
                    language: metadata.get('Language')?.replace('plain text', '') || '',
                    folderId: folderId
                });
            }

            return {
                folders: Array.from(folders.values()),
                snippets
            };
        } catch (error: any) {
            console.error('Load error:', error.response?.data || error);
            throw new Error('Failed to load snippets from GitHub Gists');
        }
    }
}