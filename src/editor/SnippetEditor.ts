import * as vscode from 'vscode';
import { LocalStorage } from '../storage/LocalStorage';

export class SnippetEditor {
    private static currentPanel: vscode.WebviewPanel | undefined;

    public static async show(
        snippet: { id: string; name: string; code: string; notes: string; language?: string; tags?: string[]; },
        localStorage: LocalStorage,
        extensionUri: vscode.Uri
    ) {
        console.log('Showing snippet editor:', snippet);

        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        try {
            if (SnippetEditor.currentPanel) {
                console.log('Reusing existing panel');
                SnippetEditor.currentPanel.reveal(column);
                SnippetEditor.currentPanel.webview.html = await getWebviewContent(
                    snippet,
                    extensionUri,
                    SnippetEditor.currentPanel.webview
                );
            } else {
                console.log('Creating new panel');
                SnippetEditor.currentPanel = vscode.window.createWebviewPanel(
                    'snippetEditor',
                    `Snippet: ${snippet.name}`,
                    column || vscode.ViewColumn.One,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true,
                        localResourceRoots: [extensionUri]
                    }
                );
                SnippetEditor.currentPanel.webview.html = await getWebviewContent(
                    snippet,
                    extensionUri,
                    SnippetEditor.currentPanel.webview
                );
            }

            SnippetEditor.currentPanel.webview.onDidReceiveMessage(
                async (message) => {
                    switch (message.command) {
                        case 'updateSnippet':
                            await localStorage.updateSnippet({
                                id: snippet.id,
                                code: message.code,
                                notes: message.notes,
                                language: message.language,
                                tags: message.tags
                            });
                            break;
                        case 'exportSnippet':
                            // Show save dialog
                            const uri = await vscode.window.showSaveDialog({
                                defaultUri: vscode.Uri.file(message.fileName),
                                filters: {
                                    'Text files': ['txt']
                                }
                            });

                            if (uri) {
                                try {
                                    // Write the file
                                    await vscode.workspace.fs.writeFile(
                                        uri,
                                        Buffer.from(message.content, 'utf8')
                                    );
                                    vscode.window.showInformationMessage('Snippet exported successfully');
                                } catch (error) {
                                    vscode.window.showErrorMessage(`Failed to export snippet: ${error}`);
                                }
                            }
                            break;
                    }
                }
            );

            SnippetEditor.currentPanel.onDidDispose(
                () => {
                    SnippetEditor.currentPanel = undefined;
                },
                null
            );
        } catch (error) {
            console.error('Error in SnippetEditor.show:', error);
            throw error;
        }
    }
}

async function getWebviewContent(
    snippet: { name: string; code: string; notes: string; language?: string; tags?: string[]; },
    extensionUri: vscode.Uri,
    webview: vscode.Webview
): Promise<string> {
    // Get the local resource URIs and convert them to webview URIs
    const monacoLoaderUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'monaco-editor', 'min', 'vs', 'loader.js')
    );
    const monacoBaseUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'monaco-editor', 'min', 'vs')
    );

    const monacoHtml = `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Snippet Editor</title>
        <script src="${monacoLoaderUri}"></script>
        <style>
            body {
                padding: 0;
                display: flex;
                flex-direction: column;
                gap: 20px;
                max-width: 100%;
                margin: 0;
                height: 100vh;
                box-sizing: border-box;
                background-color: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
            }
            .section {
                display: flex;
                flex-direction: column;
                gap: 10px;
                padding: 0 20px;
            }
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px;
                background-color: var(--vscode-editor-background);
                border-bottom: 1px solid var(--vscode-input-border);
            }
            #notes {
                width: 100%;
                min-height: 100px;
                font-family: var(--vscode-editor-font-family);
                font-size: var(--vscode-editor-font-size);
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                padding: 8px;
                resize: vertical;
                margin: 0;
                box-sizing: border-box;
            }
            #tags {
                width: 100%;
                font-family: var(--vscode-editor-font-family);
                font-size: var(--vscode-editor-font-size);
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                padding: 8px;
                margin: 0;
                box-sizing: border-box;
            }
            .tag-container {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 8px;
            }
            .tag {
                background-color: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                padding: 4px 8px;
                border-radius: 4px;
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .tag-remove {
                cursor: pointer;
                opacity: 0.7;
            }
            .tag-remove:hover {
                opacity: 1;
            }
            #editor {
                flex: 1;
                min-height: 400px;
                border: none;
                margin: 0;
                padding: 0;
            }
            .editor-container {
                flex: 1;
                display: flex;
                flex-direction: column;
                padding: 0;
                margin: 0;
            }
            select {
                width: 200px;
                padding: 4px;
                background-color: var(--vscode-dropdown-background);
                color: var(--vscode-dropdown-foreground);
                border: 1px solid var(--vscode-dropdown-border);
            }
            label {
                font-weight: bold;
                color: var(--vscode-input-placeholderForeground);
            }
            .language-section {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .code-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .export-button {
                padding: 4px 8px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 4px;
                border-radius: 2px;
            }
            .export-button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            .export-button:active {
                background-color: var(--vscode-button-background);
                transform: translateY(1px);
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h2 style="margin: 0;">${snippet.name}</h2>
            <div class="language-section">
                <label for="language">Language:</label>
                <select id="language">
                    <option value="plaintext">Plain Text</option>
                    <option value="javascript">JavaScript</option>
                    <option value="typescript">TypeScript</option>
                    <option value="python">Python</option>
                    <option value="html">HTML</option>
                    <option value="css">CSS</option>
                    <option value="json">JSON</option>
                    <option value="markdown">Markdown</option>
                    <option value="sql">SQL</option>
                    <option value="xml">XML</option>
                    <option value="yaml">YAML</option>
                    <option value="shell">Shell Script</option>
                    <option value="java">Java</option>
                    <option value="cpp">C++</option>
                    <option value="csharp">C#</option>
                    <option value="php">PHP</option>
                    <option value="ruby">Ruby</option>
                    <option value="go">Go</option>
                    <option value="rust">Rust</option>
                </select>
            </div>
        </div>
        
        <div class="section">
            <label for="notes">Notes:</label>
            <textarea id="notes" placeholder="Add your notes here...">${snippet.notes || ''}</textarea>
        </div>

        <div class="section">
            <label for="tags">Tags:</label>
            <input type="text" id="tags" placeholder="Add tags (press Enter to add)" />
            <div class="tag-container" id="tagContainer">
                ${(snippet.tags || []).map(tag => 
                    `<span class="tag" data-tag="${tag}">${tag}<span class="tag-remove">&times;</span></span>`
                ).join('')}
            </div>
        </div>
        
        <div class="editor-container">
            <div class="section" style="margin-bottom: 0;">
                <div class="code-header">
                    <label for="editor">Code:</label>
                    <button class="export-button" id="exportButton">Export as Text</button>
                </div>
            </div>
            <div id="editor"></div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            let editor;
            let debounceTimeout;
            let currentTags = new Set(${JSON.stringify(snippet.tags || [])});

            require.config({ paths: { vs: '${monacoBaseUri}' } });

            require(['vs/editor/editor.main'], function () {
                // Define theme to match VS Code
                monaco.editor.defineTheme('vscode-theme', {
                    base: 'vs-dark',
                    inherit: true,
                    rules: [],
                    colors: {
                        'editor.background': getComputedStyle(document.body).getPropertyValue('--vscode-editor-background'),
                        'editor.foreground': getComputedStyle(document.body).getPropertyValue('--vscode-editor-foreground')
                    }
                });

                monaco.editor.setTheme('vscode-theme');

                // Initialize editor with properly escaped code
                editor = monaco.editor.create(document.getElementById('editor'), {
                    value: ${JSON.stringify(snippet.code || '')},
                    language: '${snippet.language || 'plaintext'}',
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: parseInt(getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-size')),
                    fontFamily: getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-family'),
                    automaticLayout: true,
                    padding: { top: 8, bottom: 8 },
                    lineNumbers: 'on',
                    roundedSelection: false,
                    renderLineHighlight: 'all',
                    scrollbar: {
                        useShadows: false,
                        verticalHasArrows: false,
                        horizontalHasArrows: false,
                        vertical: 'visible',
                        horizontal: 'visible'
                    }
                });

                // Set up change handlers
                editor.onDidChangeModelContent(handleChange);
                document.getElementById('notes').addEventListener('input', handleChange);
                document.getElementById('language').addEventListener('change', (e) => {
                    monaco.editor.setModelLanguage(editor.getModel(), e.target.value);
                    handleChange();
                });

                // Set initial language
                document.getElementById('language').value = '${snippet.language || 'plaintext'}';

                // Set up tag input handler
                const tagInput = document.getElementById('tags');
                const tagContainer = document.getElementById('tagContainer');

                tagInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const tag = this.value.trim();
                        if (tag && !currentTags.has(tag)) {
                            currentTags.add(tag);
                            const tagElement = document.createElement('span');
                            tagElement.className = 'tag';
                            tagElement.dataset.tag = tag;
                            tagElement.innerHTML = \`\${tag}<span class="tag-remove">&times;</span>\`;
                            tagContainer.appendChild(tagElement);
                            this.value = '';
                            handleChange();
                        }
                    }
                });

                tagContainer.addEventListener('click', function(e) {
                    const target = e.target;
                    if (target.classList.contains('tag-remove')) {
                        const tag = target.parentElement;
                        if (tag && tag.dataset.tag) {
                            currentTags.delete(tag.dataset.tag);
                            tag.remove();
                            handleChange();
                        }
                    }
                });

                // Set up export button handler
                document.getElementById('exportButton').addEventListener('click', function() {
                    const code = editor.getValue();
                    const language = document.getElementById('language').value;
                    const notes = document.getElementById('notes').value;
                    
                    const content = [
                        '// Snippet: ' + ${JSON.stringify(snippet.name)},
                        '// Language: ' + language,
                        '// Notes: ' + notes.split('\\n').map(line => line ? line : '//' ).join('\\n'),
                        '// Tags: ' + Array.from(currentTags).join(', '),
                        '',
                        code
                    ].join('\\n');
                    
                    vscode.postMessage({
                        command: 'exportSnippet',
                        content: content,
                        fileName: ${JSON.stringify(snippet.name)} + (language !== 'plaintext' ? '.' + language : '') + '.txt'
                    });
                });
            });

            function handleChange() {
                clearTimeout(debounceTimeout);
                debounceTimeout = setTimeout(() => {
                    const code = editor.getValue();
                    const notes = document.getElementById('notes').value;
                    const language = document.getElementById('language').value;
                    
                    vscode.postMessage({
                        command: 'updateSnippet',
                        code,
                        notes,
                        language,
                        tags: Array.from(currentTags)
                    });
                }, 500);
            }
        </script>
    </body>
    </html>`;

    return monacoHtml;
} 