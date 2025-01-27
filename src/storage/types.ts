export interface Folder {
    id: string;
    name: string;
    parentId: string | null;  // null for root folders, string ID for sub-folders
    type: 'primary' | 'secondary';  // To distinguish between primary and secondary folders
    lastModified: number;  // Unix timestamp in milliseconds
}

export interface Snippet {
    id: string;
    name: string;
    folderId: string;
    code: string;
    language: string;
    notes: string;
    tags?: string[];  // Optional array of tags
    lastModified: number;  // Unix timestamp in milliseconds
} 