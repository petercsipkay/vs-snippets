export interface Folder {
    id: string;
    name: string;
}

export interface Snippet {
    id: string;
    name: string;
    code: string;
    notes: string;
    folderId: string;
    language?: string;
    tags?: string[];
} 