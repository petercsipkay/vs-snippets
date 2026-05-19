import * as vscode from 'vscode';

const channel = vscode.window.createOutputChannel('VS Snippets');

export function log(message: string): void {
    channel.appendLine(`[${new Date().toISOString()}] ${message}`);
}

export function logError(message: string, error?: unknown): void {
    channel.appendLine(`[${new Date().toISOString()}] ERROR: ${message}${error !== undefined ? ': ' + String(error) : ''}`);
}

export function showLog(): void {
    channel.show();
}
