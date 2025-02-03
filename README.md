# VS Code Snippets Manager - Snippy

A powerful and user friendly VS Code extension for managing your code snippets with local backup support. Works with VS Code and all VS Code-based editors including VSCodium, GitPod, and GitHub Codespaces.

## Features

-   📝 Create and organize code snippets with a modern editor
-   📁 Advanced folder organization
    -   Create folders and subfolders
    -   Drag and drop snippets and folders
    -   Rename folders and snippets
-   🔍 Powerful search functionality
    -   Search in snippet names, content, notes, and tags
    -   Real-time search results
-   🎨 Rich code editing
    -   Syntax highlighting for 40+ programming languages
    -   Modern Monaco editor integration
    -   Language specific icons
-   📝 Snippet metadata
    -   Add notes to snippets
    -   Language specification
    -   Tags support
-   💾 Backup and sync
    -   Local backup support
    -   Import/Export functionality
    -   Auto sync on startup option
    -   Configurable backup location
    -   Cloud sync support (via Dropbox, Google Drive, etc.)
-   🔄 Cross-platform compatibility
    -   Works with VS Code based editors

## Getting Started

1. Install the extension from:
    - VS Code Marketplace for VS Code and GitHub Codespaces
2. Start creating folders and snippets

### Managing Snippets

1. Create folders to organize your snippets
    - Click the "+" icon in the title bar to create root folders
    - Use the folder context menu to create subfolders
2. Add snippets to folders
    - Click the "New File" icon on a folder
    - Use drag and drop to move snippets between folders
3. Edit snippets in the dedicated snippet editor
    - Add your code
    - Specify the programming language
    - Add notes and tags
4. Organize your structure
    - Drag and drop folders to reorganize
    - Rename folders and snippets as needed
    - Delete items you no longer need

### Backup and Sync

1. Open VS Code Settings (`Ctrl/Cmd + ,`)
2. Search for "Snippets Manager"
3. Configure:
    - Backup Folder location
    - Auto-sync on startup option

### Cloud Sync Setup

You can use any cloud storage service to sync your snippets across computers:

1. Using Dropbox:

    - Set your backup folder to a location inside your Dropbox folder
    - Enable auto-sync on startup
    - Dropbox will automatically sync the backup file across your computers

2. Using Google Drive:

    - Set your backup folder to a location inside your Google Drive folder
    - Enable auto-sync on startup
    - Google Drive will handle the synchronization automatically

3. Using OneDrive:

    - Set your backup folder to a location inside your OneDrive folder
    - Enable auto-sync on startup
    - OneDrive will keep your snippets in sync across devices

4. Using any other cloud service:
    - Choose any cloud service that provides a local sync folder
    - Set your backup folder to that location
    - Enable auto-sync on startup
    - Your cloud service will handle the rest

Tips for cloud sync:

-   Use the same backup folder path on all your computers
-   Let the sync complete before closing VS Code
-   If conflicts occur, you can always import the backup file manually

## License
