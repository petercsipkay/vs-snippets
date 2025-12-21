import * as vscode from 'vscode';

export class SnippetEditor {
    private static readonly viewType = 'text';
    private static panels = new Map<string, vscode.WebviewPanel>();
    private disposables: vscode.Disposable[] = [];

    constructor() {
        // Initialize any disposables if needed
    }

    dispose() {
        // Clean up any instance-specific disposables
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];

        // Clean up all panels
        SnippetEditor.disposeAll();
    }

    static async show(snippet: {
        id: string;
        name: string;
        code: string;
        notes: string;
        language?: string;
        tags?: string[];
    }) {
        // Check if panel already exists
        const existingPanel = this.panels.get(snippet.id);
        if (existingPanel) {
            existingPanel.reveal();
            return existingPanel;
        }

        // Create new panel for the snippet
        const panel = vscode.window.createWebviewPanel(
            this.viewType,
            `\u200b\u200b\u200b${snippet.name}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        // Store the panel
        this.panels.set(snippet.id, panel);

        // Remove from tracking when closed
        panel.onDidDispose(() => {
            this.panels.delete(snippet.id);
        });

        panel.webview.html = await this.getWebviewContent(snippet);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(async message => {
            console.log('[DEBUG] Received message from webview:', message);

            if (message.command === 'save') {
                try {
                    console.log('[DEBUG] Saving snippet with data:', {
                        id: snippet.id,
                        code: message.code,
                        notes: message.notes,
                        language: message.language,
                        tags: message.tags
                    });

                    await vscode.commands.executeCommand('snippets.updateSnippet', {
                        id: snippet.id,
                        code: message.code,
                        notes: message.notes,
                        language: message.language,
                        tags: Array.isArray(message.tags) ? message.tags : []
                    });

                    console.log('[DEBUG] Snippet saved successfully');
                    vscode.window.showInformationMessage('Snippet saved successfully');
                } catch (error: any) {
                    console.error('[DEBUG] Error saving snippet:', error);
                    vscode.window.showErrorMessage('Failed to save snippet: ' + (error.message || 'Unknown error'));
                }
            }
        });

        return panel;
    }

    private static async getWebviewContent(snippet: {
        name: string;
        code: string;
        notes: string;
        language?: string;
        tags?: string[];
    }): Promise<string> {
        // Language options for the dropdown
        const languageOptions = [
            // Popular Languages
            { label: 'JavaScript', value: 'javascript' },
            { label: 'TypeScript', value: 'typescript' },
            { label: 'Python', value: 'python' },
            { label: 'Java', value: 'java' },
            { label: 'C#', value: 'csharp' },
            { label: 'C++', value: 'cpp' },
            { label: 'C', value: 'c' },
            { label: 'Swift', value: 'swift' },
            { label: 'Go', value: 'go' },
            { label: 'Rust', value: 'rust' },
            { label: 'PHP', value: 'php' },
            { label: 'Ruby', value: 'ruby' },
            { separator: true, label: '──────────' },

            // Web Development
            { label: 'HTML', value: 'html' },
            { label: 'CSS', value: 'css' },
            { label: 'SCSS', value: 'scss' },
            { label: 'SASS', value: 'sass' },
            { label: 'Less', value: 'less' },
            { label: 'PostCSS', value: 'postcss' },
            { label: 'Tailwind CSS', value: 'tailwindcss' },
            { separator: true, label: '──────────' },

            // Web Frameworks
            { label: 'React', value: 'javascriptreact' },
            { label: 'Vue', value: 'vue' },
            { label: 'Angular', value: 'typescript' },
            { label: 'Svelte', value: 'svelte' },
            { label: 'Astro', value: 'astro' },
            { separator: true, label: '──────────' },

            // Data & Config
            { label: 'JSON', value: 'json' },
            { label: 'XML', value: 'xml' },
            { label: 'YAML', value: 'yaml' },
            { label: 'TOML', value: 'toml' },
            { label: 'INI', value: 'ini' },
            { label: 'ENV', value: 'env' },
            { separator: true, label: '──────────' },

            // Shell & Scripting
            { label: 'Shell Script', value: 'shell' },
            { label: 'Bash', value: 'bash' },
            { label: 'PowerShell', value: 'powershell' },
            { label: 'Batch', value: 'batch' },
            { separator: true, label: '──────────' },

            // Database
            { label: 'SQL', value: 'sql' },
            { label: 'PL/SQL', value: 'plsql' },
            { label: 'MongoDB', value: 'mongodb' },
            { separator: true, label: '──────────' },

            // Other Languages
            { label: 'Kotlin', value: 'kotlin' },
            { label: 'Dart', value: 'dart' },
            { label: 'R', value: 'r' },
            { label: 'Perl', value: 'perl' },
            { label: 'Lua', value: 'lua' },
            { label: 'Scala', value: 'scala' },
            { label: 'GraphQL', value: 'graphql' },
            { label: 'Markdown', value: 'markdown' },
            { label: 'LaTeX', value: 'latex' },
            { label: 'Plain Text', value: 'plaintext' }
        ];

        // Create a data URI with the code content
        const codeDataUri = `data:text/plain;base64,${Buffer.from(snippet.code).toString('base64')}`;

        const editorScript = `
            const vscode = acquireVsCodeApi();
            let currentTags = new Set(${JSON.stringify(snippet.tags || [])});
            let editor;

            // NOTE: We load Monaco Editor from a CDN to avoid bundling the entire editor with the extension.
            // This requires an internet connection to use the editor.
            // In a future update, we could bundle it to allow offline usage, but it significantly increases the extension size.
            require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});
            require(['vs/editor/editor.main'], async function() {
                monaco.editor.defineTheme('vscode-dark', {
                    base: 'vs-dark',
                    inherit: true,
                    rules: [],
                    colors: {
                        'editor.background': getComputedStyle(document.body).getPropertyValue('--vscode-editor-background'),
                        'editor.foreground': getComputedStyle(document.body).getPropertyValue('--vscode-editor-foreground')
                    }
                });

                monaco.editor.setTheme('vscode-dark');

                const language = ${JSON.stringify(snippet.language || 'plaintext')};
                let editorLanguage = language;
                
                switch (language) {
                    case 'javascriptreact':
                        editorLanguage = 'javascript';
                        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
                            jsx: monaco.languages.typescript.JsxEmit.React,
                            allowNonTsExtensions: true,
                            allowJs: true,
                            target: monaco.languages.typescript.ScriptTarget.Latest
                        });
                        break;
                    case 'typescriptreact':
                        editorLanguage = 'typescript';
                        monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
                            jsx: monaco.languages.typescript.JsxEmit.React,
                            allowNonTsExtensions: true,
                            target: monaco.languages.typescript.ScriptTarget.Latest
                        });
                        break;
                    case 'vue':
                    case 'nuxt':
                        editorLanguage = 'html';
                        monaco.languages.html.htmlDefaults.setOptions({
                            format: {
                                templating: true,
                                unformatted: ['script', 'style'],
                                contentUnformatted: ['pre', 'code', 'textarea']
                            },
                            suggest: {
                                html5: true
                            }
                        });
                        break;
                    case 'svelte':
                        editorLanguage = 'html';
                        monaco.languages.html.htmlDefaults.setOptions({
                            format: {
                                templating: true,
                                unformatted: ['script', 'style'],
                                contentUnformatted: ['pre', 'code', 'textarea']
                            }
                        });
                        break;
                    case 'astro':
                        editorLanguage = 'html';
                        monaco.languages.html.htmlDefaults.setOptions({
                            format: {
                                templating: true
                            }
                        });
                        break;
                }

                // Fetch the code content from the data URI
                const response = await fetch('${codeDataUri}');
                const code = await response.text();

                // Create editor with the fetched code
                const editorOptions = {
                    value: code,
                    language: editorLanguage,
                    theme: 'vscode-dark',
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: parseInt(getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-size')) || 14,
                    fontFamily: getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-family'),
                    automaticLayout: true,
                    padding: { top: 10, bottom: 10 }
                };

                editor = monaco.editor.create(document.getElementById('editor'), editorOptions);

                // Handle language change
                document.getElementById('language').addEventListener('change', function() {
                    const newLanguage = this.value || 'plaintext';
                    let editorLang = newLanguage;
                    
                    switch (newLanguage) {
                        case 'javascriptreact':
                            editorLang = 'javascript';
                            monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
                                jsx: monaco.languages.typescript.JsxEmit.React,
                                allowNonTsExtensions: true,
                                allowJs: true,
                                target: monaco.languages.typescript.ScriptTarget.Latest
                            });
                            break;
                        case 'typescriptreact':
                            editorLang = 'typescript';
                            monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
                                jsx: monaco.languages.typescript.JsxEmit.React,
                                allowNonTsExtensions: true,
                                target: monaco.languages.typescript.ScriptTarget.Latest
                            });
                            break;
                        case 'vue':
                        case 'nuxt':
                            editorLang = 'html';
                            monaco.languages.html.htmlDefaults.setOptions({
                                format: {
                                    templating: true,
                                    unformatted: ['script', 'style'],
                                    contentUnformatted: ['pre', 'code', 'textarea']
                                },
                                suggest: {
                                    html5: true
                                }
                            });
                            break;
                        case 'svelte':
                            editorLang = 'html';
                            monaco.languages.html.htmlDefaults.setOptions({
                                format: {
                                    templating: true,
                                    unformatted: ['script', 'style'],
                                    contentUnformatted: ['pre', 'code', 'textarea']
                                }
                            });
                            break;
                        case 'astro':
                            editorLang = 'html';
                            monaco.languages.html.htmlDefaults.setOptions({
                                format: {
                                    templating: true
                                }
                            });
                            break;
                    }
                    
                    monaco.editor.setModelLanguage(editor.getModel(), editorLang);
                    handleChange();
                });

                // Handle tag input
                const tagInput = document.getElementById('tag-input');
                const tagContainer = document.getElementById('tag-container');

                tagInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const tag = this.value.trim();
                        if (tag && !currentTags.has(tag)) {
                            currentTags.add(tag);
                            const tagElement = document.createElement('span');
                            tagElement.className = 'tag';
                            tagElement.dataset.tag = tag;
                            tagElement.innerHTML = tag + '<span class="tag-remove">&times;</span>';
                            tagContainer.appendChild(tagElement);
                            this.value = '';
                            handleChange();
                        }
                    }
                });

                // Handle tag removal
                tagContainer.addEventListener('click', function(e) {
                    if (e.target.classList.contains('tag-remove')) {
                        const tag = e.target.parentElement;
                        if (tag && tag.dataset.tag) {
                            currentTags.delete(tag.dataset.tag);
                            tag.remove();
                            handleChange();
                        }
                    }
                });

                let saveTimeout;
                function handleChange() {
                    clearTimeout(saveTimeout);
                    saveTimeout = setTimeout(() => {
                        try {
                            const language = document.getElementById('language').value;
                            const code = editor.getValue();
                            const notes = document.getElementById('notes').value;
                            const tags = Array.from(currentTags);
                            
                            console.log('Sending save message:', {
                                command: 'save',
                                language,
                                code,
                                notes,
                                tags
                            });

                            vscode.postMessage({
                                command: 'save',
                                language,
                                code,
                                notes,
                                tags
                            });
                        } catch (error) {
                            console.error('Error in handleChange:', error);
                        }
                    }, 500);
                }

                editor.onDidChangeModelContent(() => handleChange());
                document.getElementById('notes').addEventListener('input', handleChange);
            });
        `;

        return `<!DOCTYPE html>
        <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Snippet Editor</title>
                <style>
                    body {
                        padding: 0;
                        display: flex;
                        flex-direction: column;
                        margin: 0;
                        height: 100vh;
                        box-sizing: border-box;
                        background-color: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                        font-family: var(--vscode-font-family);
                    }
                    .header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 10px 20px;
                        background-color: var(--vscode-editor-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        gap: 20px;
                    }
                    .header-title {
                        flex-grow: 1;
                    }
                    .header select {
                        width: 200px;
                    }
                    .section {
                        padding: 10px 0;
                    }
                    .top-section {
                        padding: 10px 20px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    select, input, textarea {
                        width: 100%;
                        padding: 6px;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 2px;
                    }
                    select:focus, input:focus, textarea:focus {
                        outline: 1px solid var(--vscode-focusBorder);
                    }
                    #editor {
                        height: calc(100vh - 250px);
                        border: none;
                    }
                    .tag-container {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 5px;
                        margin: 10px 0;
                    }
                    .tag {
                        background: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        padding: 4px 8px;
                        border-radius: 3px;
                        display: flex;
                        align-items: center;
                        font-size: 12px;
                    }
                    .tag-remove {
                        margin-left: 6px;
                        cursor: pointer;
                        opacity: 0.7;
                    }
                    .tag-remove:hover {
                        opacity: 1;
                    }
                    label {
                        display: block;
                        margin-bottom: 6px;
                        color: var(--vscode-foreground);
                        font-weight: 500;
                    }
                    label[for="tag-input"], 
                    label:has(+ #tag-input) {
                        margin-top: 5px;
                    }
                    #notes {
                        min-height: 60px;
                        resize: vertical;
                    }
                    h2 {
                        margin: 0;
                        padding: 6px 0;
                        color: var(--vscode-foreground);
                    }
                    .editor-container {
                        flex-grow: 1;
                        position: relative;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="header-title">
                        <h2>${snippet.name}</h2>
                    </div>
                    <select id="language">
                        <option value="">Select a language...</option>
                        ${languageOptions.map(lang =>
            lang.separator
                ? `<option disabled>${lang.label}</option>`
                : `<option value="${lang.value}" ${lang.value === snippet.language ? 'selected' : ''}>${lang.label}</option>`
        ).join('')}
                    </select>
                </div>

                <div class="top-section">
                    <label>Notes:</label>
                    <textarea id="notes" rows="3">${snippet.notes || ''}</textarea>

                    <label>Tags:</label>
                    <input type="text" id="tag-input" placeholder="Add a tag (press Enter)">
                    <div class="tag-container" id="tag-container">
                        ${(snippet.tags || []).map(tag =>
            `<span class="tag" data-tag="${tag}">${tag}<span class="tag-remove">&times;</span></span>`
        ).join('')}
                    </div>
                </div>

                <div class="editor-container">
                    <div id="editor"></div>
                </div>

                <script src="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/loader.js"></script>
                <script>${editorScript}</script>
            </body>
        </html>`;
    }

    static disposeAll() {
        // Dispose all panels
        for (const panel of this.panels.values()) {
            panel.dispose();
        }
        this.panels.clear();
    }
} 