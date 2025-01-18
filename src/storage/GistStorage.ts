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
            console.log('Starting sync to GitHub Gists...');
            console.log(`Found ${localData.snippets.length} snippets to sync`);

            // Get all current mappings
            const config = vscode.workspace.getConfiguration('snippets');
            const gistMapping = { ...(await config.get<{ [key: string]: string }>('gistMapping') || {}) };
            
            // Find and remove mappings for deleted snippets
            const localSnippetIds = new Set(localData.snippets.map(s => s.id));
            for (const [snippetId, gistId] of Object.entries(gistMapping)) {
                if (!localSnippetIds.has(snippetId)) {
                    console.log(`Deleting gist for removed snippet ${snippetId}`);
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
                        console.log('Error deleting gist:', error.response?.status, error.response?.data);
                    }
                    await this.removeGistMapping(snippetId);
                }
            }

            // Process each snippet
            for (const snippet of localData.snippets) {
                console.log(`\nProcessing snippet: ${snippet.name}`);
                const gistId = await this.getSnippetGistId(snippet.id);
                const folder = localData.folders.find(f => f.id === snippet.folderId);
                const description = `VS Code Snippet: ${snippet.name} (${folder?.name || 'No Folder'})`;

                // Create a more structured content format
                const fileName = `${snippet.name}${snippet.language ? '.' + snippet.language : '.txt'}`;
                const metadata = {
                    name: snippet.name,
                    folder: folder?.name || 'No Folder',
                    language: snippet.language || 'plaintext',
                    notes: snippet.notes || '',
                    id: snippet.id,
                    folderId: snippet.folderId
                };

                const content = JSON.stringify({
                    metadata,
                    code: snippet.code
                }, null, 2);

                console.log('Gist content preview:', content.substring(0, 100) + '...');

                const gistContent = {
                    [fileName]: {
                        content: content
                    }
                };

                if (gistId) {
                    console.log(`Updating existing gist ${gistId}`);
                    try {
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
                        console.log('Gist updated successfully');
                    } catch (error: any) {
                        if (error.response?.status === 404) {
                            console.log('Gist not found, creating new one');
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
                            console.log('New gist created successfully');
                        } else {
                            throw error;
                        }
                    }
                } else {
                    console.log('Creating new gist');
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
                    console.log('New gist created successfully');
                }
            }

            console.log('\nSync completed successfully');
            vscode.window.showInformationMessage('Successfully synced all snippets to GitHub Gists');
        } catch (error: any) {
            console.error('Sync error:', error.response?.data || error);
            const errorMessage = error.response?.data?.message || error.message;
            console.error('Detailed error:', errorMessage);
            
            if (error.response?.status === 401) {
                throw new Error('GitHub token is invalid or expired. Please reconfigure your token.');
            } else if (error.response?.status === 403) {
                throw new Error('Rate limit exceeded or insufficient permissions. Please check your token has the gist scope.');
            } else {
                throw new Error(`Failed to sync snippets: ${errorMessage}`);
            }
        }
    }

    async load(): Promise<GistData | null> {
        try {
            console.log('Starting Gist sync process...');
            
            // Check token
            if (!this.token) {
                const storedToken = await vscode.workspace.getConfiguration().get<string>('snippets.githubToken');
                if (!storedToken) {
                    vscode.window.showErrorMessage('No GitHub token configured. Please configure your GitHub token first.');
                    return null;
                }
                console.log('Found stored GitHub token');
                this.token = storedToken;
            }

            // Verify token works
            try {
                console.log('Verifying GitHub token...');
                await axios.get('https://api.github.com/user', {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'Authorization': `Bearer ${this.token}`,
                        'X-GitHub-Api-Version': '2022-11-28',
                        'User-Agent': 'VS-Code-Snippets-Manager'
                    }
                });
                console.log('GitHub token verified successfully');
            } catch (error: any) {
                console.error('Token verification failed:', error.response?.data || error);
                vscode.window.showErrorMessage('GitHub token verification failed. Please reconfigure your token.');
                return null;
            }

            // Get gist mappings
            console.log('Fetching gist mappings...');
            const config = vscode.workspace.getConfiguration('snippets');
            const gistMapping = await config.get<{ [key: string]: string }>('gistMapping');
            
            console.log('Current gist mapping:', gistMapping);

            if (!gistMapping || Object.keys(gistMapping).length === 0) {
                vscode.window.showInformationMessage('No snippets have been pushed to GitHub yet. Please push some snippets first.');
                return null;
            }

            console.log(`Found ${Object.keys(gistMapping).length} gist mappings`);
            const folders = new Map<string, Folder>();
            const snippets: Snippet[] = [];

            // Load each snippet from its Gist
            for (const [snippetId, gistId] of Object.entries(gistMapping)) {
                try {
                    console.log(`\nFetching gist ${gistId} for snippet ${snippetId}`);
                    const response = await axios.get<SnippetGist>(`https://api.github.com/gists/${gistId}`, {
                        headers: {
                            'Accept': 'application/vnd.github.v3+json',
                            'Authorization': `Bearer ${this.token}`,
                            'X-GitHub-Api-Version': '2022-11-28',
                            'User-Agent': 'VS-Code-Snippets-Manager'
                        }
                    });

                    console.log('Gist response:', {
                        description: response.data.description,
                        files: Object.keys(response.data.files)
                    });

                    // Get the first file from the gist
                    const file = Object.values(response.data.files)[0];
                    if (!file || !file.content) {
                        console.log(`No content found in gist ${gistId}`);
                        continue;
                    }

                    const content = file.content;
                    console.log('Content preview:', content.substring(0, 100) + '...');

                    try {
                        // Try to parse as JSON first (new format)
                        const parsedContent = JSON.parse(content);
                        console.log('Successfully parsed JSON content');

                        const { metadata, code } = parsedContent;
                        
                        // Add folder if it doesn't exist and has valid data
                        if (metadata.folderId && metadata.folder && !folders.has(metadata.folderId)) {
                            folders.set(metadata.folderId, {
                                id: metadata.folderId,
                                name: metadata.folder
                            });
                            console.log(`Added folder: ${metadata.folder}`);
                        }

                        // Create the snippet
                        const snippet: Snippet = {
                            id: metadata.id || snippetId,
                            name: metadata.name || '',
                            code: code || '',
                            notes: metadata.notes || '',
                            folderId: metadata.folderId || '',
                            language: metadata.language || 'plaintext'
                        };

                        console.log('Created snippet:', {
                            id: snippet.id,
                            name: snippet.name,
                            language: snippet.language,
                            codeLength: snippet.code.length
                        });

                        // Only add valid snippets
                        if (snippet.id && snippet.name && snippet.folderId) {
                            snippets.push(snippet);
                            console.log(`Added snippet: ${snippet.name}`);
                        } else {
                            console.log('Invalid snippet data:', {
                                hasId: !!snippet.id,
                                hasName: !!snippet.name,
                                hasFolderId: !!snippet.folderId
                            });
                        }
                    } catch (parseError) {
                        console.log('Failed to parse JSON, trying legacy format');
                        // Try legacy format (comment-based)
                        const lines = content.split('\n');
                        const metadata = new Map<string, string>();
                        let codeStartIndex = -1;
                        
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i].trim();
                            if (line.startsWith('//')) {
                                const colonIndex = line.indexOf(':');
                                if (colonIndex !== -1) {
                                    const key = line.substring(2, colonIndex).trim();
                                    const value = line.substring(colonIndex + 1).trim();
                                    metadata.set(key, value);
                                    console.log(`Parsed metadata: ${key} = ${value}`);
                                }
                            } else {
                                codeStartIndex = i;
                                break;
                            }
                        }

                        const code = lines.slice(codeStartIndex).join('\n').trim();
                        const folderId = metadata.get('Folder ID') || '';
                        const folderName = metadata.get('Folder') || '';

                        if (folderId && folderName && !folders.has(folderId)) {
                            folders.set(folderId, {
                                id: folderId,
                                name: folderName
                            });
                            console.log(`Added folder: ${folderName}`);
                        }

                        const snippet: Snippet = {
                            id: metadata.get('ID') || snippetId,
                            name: metadata.get('Snippet Name') || '',
                            code: code,
                            notes: metadata.get('Notes') || '',
                            folderId: folderId,
                            language: metadata.get('Language') || 'plaintext'
                        };

                        if (snippet.id && snippet.name && snippet.folderId) {
                            snippets.push(snippet);
                            console.log(`Added snippet: ${snippet.name}`);
                        }
                    }
                } catch (error: any) {
                    console.error(`Error processing gist ${gistId}:`, error.response?.data || error);
                    if (error.response?.status === 404) {
                        console.log('Removing invalid gist mapping for', snippetId);
                        delete gistMapping[snippetId];
                        await config.update('gistMapping', gistMapping, true);
                    }
                    continue;
                }
            }

            console.log(`\nSync Summary:`);
            console.log(`- Loaded ${snippets.length} snippets`);
            console.log(`- Loaded ${folders.size} folders`);
            
            if (snippets.length === 0) {
                vscode.window.showWarningMessage('No valid snippets were found in your GitHub Gists.');
            }

            return {
                folders: Array.from(folders.values()),
                snippets
            };
        } catch (error: any) {
            console.error('Load error:', error.response?.data || error);
            const errorMessage = error.response?.data?.message || error.message;
            console.error('Detailed error:', errorMessage);
            
            if (error.response?.status === 401) {
                vscode.window.showErrorMessage('GitHub token is invalid or expired. Please reconfigure your token.');
            } else if (error.response?.status === 403) {
                vscode.window.showErrorMessage('Rate limit exceeded or insufficient permissions. Please check your token has the gist scope.');
            } else if (error.response?.status === 404) {
                vscode.window.showErrorMessage('One or more gists not found. They may have been deleted.');
            } else {
                vscode.window.showErrorMessage(`Failed to load snippets: ${errorMessage}`);
            }
            
            throw error;
        }
    }
}