import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class BackupManager {
    private static getDefaultBackupFolder(): string {
        const homeDir = os.homedir();
        switch (os.platform()) {
            case 'win32':
                return path.join(homeDir, 'Documents', 'CodeSnippets');
            case 'darwin':
                return path.join(homeDir, 'Library', 'Application Support', 'CodeSnippets');
            default: // Linux and others
                return path.join(homeDir, '.config', 'codesnippets');
        }
    }

    static async getBackupFolder(): Promise<string> {
        const config = vscode.workspace.getConfiguration('snippets');
        let backupFolder = config.get<string>('backupFolder');

        if (!backupFolder) {
            backupFolder = this.getDefaultBackupFolder();
            await config.update('backupFolder', backupFolder, true);
        }

        // Ensure the folder exists
        if (!fs.existsSync(backupFolder)) {
            fs.mkdirSync(backupFolder, { recursive: true });
        }

        return backupFolder;
    }

    static async configureBackupFolder(): Promise<void> {
        const currentFolder = await this.getBackupFolder();
        
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: vscode.Uri.file(currentFolder),
            openLabel: 'Select Backup Folder'
        };

        const result = await vscode.window.showOpenDialog(options);
        if (result && result[0]) {
            const newFolder = result[0].fsPath;
            await vscode.workspace.getConfiguration('snippets').update('backupFolder', newFolder, true);
            
            // Ensure the folder exists
            if (!fs.existsSync(newFolder)) {
                fs.mkdirSync(newFolder, { recursive: true });
            }

            vscode.window.showInformationMessage(`Backup folder set to: ${newFolder}`);
        }
    }

    static async backupSnippet(snippet: {
        id: string;
        name: string;
        code: string;
        notes: string;
        language?: string;
        tags?: string[];
    }): Promise<void> {
        const backupFolder = await this.getBackupFolder();
        const fileName = `${snippet.name.replace(/[^a-z0-9]/gi, '_')}.${snippet.language || 'txt'}`;
        const filePath = path.join(backupFolder, fileName);

        const content = [
            `// Snippet: ${snippet.name}`,
            `// Language: ${snippet.language || 'plaintext'}`,
            `// Tags: ${(snippet.tags || []).join(', ')}`,
            '// Notes:',
            ...snippet.notes.split('\n').map(line => `// ${line}`),
            '',
            snippet.code
        ].join('\n');

        fs.writeFileSync(filePath, content, 'utf8');
    }
} 