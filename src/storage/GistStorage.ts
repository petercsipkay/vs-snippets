import * as vscode from 'vscode';
import axios from 'axios';
import { Folder, Snippet, GistData } from './types';
import { LocalStorage } from './LocalStorage';

interface GistFile {
    content: string;
    truncated?: boolean;
    size?: number;
}

interface GistResponse {
    files: { [key: string]: GistFile };
    description: string;
}

interface SnippetGist {
    id: string;
    name: string;
    code: string;
    notes: string;
    folderId: string;
    language?: string;
}

export class GistStorage {
    private localStorage: LocalStorage;
    private octokit: any;  // Replace with proper Octokit type if available
    private token: string | null = null;
    private gistId: string | null = null;

    constructor(localStorage: LocalStorage) {
        this.localStorage = localStorage;
    }

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
        if (!this.token) {
            console.log('No GitHub token configured');
            return null;
        }

        try {
            console.log('Starting to load snippets from GitHub Gists');
            const config = vscode.workspace.getConfiguration('snippets');
            const gistMapping = config.get<Record<string, string>>('gistMapping') || {};
            console.log(`Found ${Object.keys(gistMapping).length} gist mappings`);

            const folders = new Map<string, Folder>();
            const snippets: Snippet[] = [];

            for (const [snippetId, gistId] of Object.entries(gistMapping)) {
                try {
                    const response = await axios.get<GistResponse>(`https://api.github.com/gists/${gistId}`, {
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
                                name: metadata.folder,
                                type: 'primary',  // Default to primary for imported folders
                                parentId: null    // Default to root level
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

                        // Only add valid snippets
                        if (snippet.id && snippet.name && snippet.folderId) {
                            snippets.push(snippet);
                            console.log(`Added snippet: ${snippet.name}`);
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
                                name: folderName,
                                type: 'primary',  // Default to primary for imported folders
                                parentId: null    // Default to root level
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
                    continue;
                }
            }

            return {
                folders: Array.from(folders.values()),
                snippets
            };
        } catch (error: any) {
            console.error('Load error:', error.response?.data || error);
            throw error;
        }
    }

    async syncToGist(): Promise<void> {
        try {
            const folders = await this.localStorage.getFolders();
            const snippets = await this.localStorage.getSnippets();
            
            const data: GistData = {
                folders,
                snippets
            };

            await this.pushToGist(data);
        } catch (error) {
            console.error('Error syncing to gist:', error);
            throw error;
        }
    }

    async syncFromGist(): Promise<void> {
        try {
            const data = await this.pullFromGist();
            await this.localStorage.syncData(data);
        } catch (error) {
            console.error('Error syncing from gist:', error);
            throw error;
        }
    }

    private async pullFromGist(): Promise<GistData> {
        if (!this.token || !this.gistId) {
            throw new Error('GitHub token or Gist ID not configured');
        }

        try {
            const response = await axios.get<GistResponse>(`https://api.github.com/gists/${this.gistId}`, {
                headers: {
                    'Authorization': `token ${this.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            const gist = response.data;
            const folders: Folder[] = [];
            const snippets: Snippet[] = [];
            const folderMap = new Map<string, Folder>();

            for (const [filename, file] of Object.entries(gist.files)) {
                const content = file.content;
                const lines = content.split('\n');
                let metadata: Record<string, string> = {};
                let codeStartIndex = -1;

                // Parse metadata
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line === '```') {
                        codeStartIndex = i + 1;
                        break;
                    }
                    if (line.includes(':')) {
                        const [key, value] = line.split(':').map((s: string) => s.trim());
                        metadata[key.toLowerCase()] = value;
                    }
                }

                // Create folder if it doesn't exist
                if (metadata.folderid && !folderMap.has(metadata.folderid)) {
                    const folder: Folder = {
                        id: metadata.folderid,
                        name: metadata.folder || 'Imported',
                        type: 'primary',
                        parentId: null  // Root level folder
                    };
                    folderMap.set(folder.id, folder);
                    folders.push(folder);
                }

                // Create snippet
                if (metadata.id && metadata.name && metadata.folderid) {
                    const snippet: Snippet = {
                        id: metadata.id,
                        name: metadata.name,
                        folderId: metadata.folderid,
                        language: metadata.language || 'plaintext',
                        notes: metadata.notes || '',
                        code: lines.slice(codeStartIndex, -1).join('\n')
                    };
                    snippets.push(snippet);
                }
            }

            return { folders, snippets };
        } catch (error) {
            console.error('Error pulling from gist:', error);
            throw error;
        }
    }

    private async pushToGist(data: GistData): Promise<void> {
        if (!this.token || !this.gistId) {
            throw new Error('GitHub token or Gist ID not configured');
        }

        try {
            const files: { [key: string]: { content: string } } = {};

            // Create a file for each snippet
            data.snippets.forEach((snippet, index) => {
                // Find the folder for this snippet
                const folder = data.folders.find(f => f.id === snippet.folderId);
                if (!folder) {
                    console.warn(`Folder not found for snippet ${snippet.id}`);
                    return;
                }

                // Create the content with metadata
                const content = [
                    `Snippet Name: ${snippet.name}`,
                    `Folder: ${folder.name}`,
                    `Folder ID: ${folder.id}`,
                    `ID: ${snippet.id}`,
                    `Language: ${snippet.language}`,
                    snippet.notes ? `Notes: ${snippet.notes}` : '',
                    '```',
                    snippet.code,
                    '```'
                ].join('\n');

                // Add the file to the gist
                files[`snippet_${index + 1}.txt`] = { content };
            });

            // Update the gist
            await axios.patch(`https://api.github.com/gists/${this.gistId}`, {
                files,
                description: 'VS Code Snippets Backup'
            }, {
                headers: {
                    'Authorization': `token ${this.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            console.log('Successfully pushed snippets to Gist');
        } catch (error) {
            console.error('Error pushing to gist:', error);
            throw error;
        }
    }
}