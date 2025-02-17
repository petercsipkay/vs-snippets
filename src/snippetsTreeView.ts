import * as vscode from 'vscode';

export class SnippetsTreeViewProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.TreeDragAndDropController<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    dropMimeTypes = ['application/vnd.code.tree.snippetsExplorer'];
    dragMimeTypes = ['application/vnd.code.tree.snippetsExplorer'];

    // Add support for all drop locations
    public async handleDrop(target: vscode.TreeItem | undefined, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        const droppedItems = dataTransfer.get('application/vnd.code.tree.snippetsExplorer')?.value as vscode.TreeItem[];
        if (!droppedItems) {
            return;
        }

        for (const item of droppedItems) {
            if (item.contextValue === 'folder') {
                if (!target) {
                    // Moving to root level
                    await this.moveToRoot(item);
                } else if (target.contextValue === 'folder') {
                    // Moving to another folder
                    await this.moveToFolder(item, target);
                }
            }
        }
    }

    public async handleDrag(sources: vscode.TreeItem[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        // Only allow dragging folders
        const draggableSources = sources.filter(item => item.contextValue === 'folder');
        if (draggableSources.length > 0) {
            dataTransfer.set('application/vnd.code.tree.snippetsExplorer', new vscode.DataTransferItem(draggableSources));
        }
    }

    private async moveToRoot(item: vscode.TreeItem) {
        try {
            // Get the item's current parent path and new path
            const currentPath = (item as any).folderPath; // You'll need to adjust this based on your TreeItem implementation
            if (!currentPath) {
                return;
            }

            // Move the folder to root level in your data structure
            // You'll need to implement this based on how you store your folders
            await this.moveFolderInStorage(currentPath, '');
            
            // Refresh the tree view
            this._onDidChangeTreeData.fire();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to move folder to root: ${error}`);
        }
    }

    private async moveToFolder(sourceItem: vscode.TreeItem, targetItem: vscode.TreeItem) {
        try {
            // Get the source and target paths
            const sourcePath = (sourceItem as any).folderPath;
            const targetPath = (targetItem as any).folderPath;
            
            if (!sourcePath || !targetPath) {
                return;
            }

            // Don't allow moving a folder into itself or its children
            if (targetPath.startsWith(sourcePath)) {
                vscode.window.showErrorMessage("Cannot move a folder into itself or its subfolders");
                return;
            }

            // Move the folder in your data structure
            await this.moveFolderInStorage(sourcePath, targetPath);
            
            // Refresh the tree view
            this._onDidChangeTreeData.fire();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to move folder: ${error}`);
        }
    }

    private async moveFolderInStorage(sourcePath: string, targetPath: string) {
        // TODO: Implement this method based on your storage implementation
        // This should:
        // 1. Get the folder data from the source path
        // 2. Remove it from its current location
        // 3. Add it to the target location
        // 4. Update any necessary path references
        console.log(`Moving folder from ${sourcePath} to ${targetPath}`);
    }

    // Required TreeDataProvider methods
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(_element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        // Implement your existing getChildren logic here
        return Promise.resolve([]);
    }
} 