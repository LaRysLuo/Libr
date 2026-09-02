export type AssetKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "document"
  | "font"
  | "archive"
  | "other";

export type ImportMode = "map" | "copy" | "move";

export interface LibraryInfo {
  id: string;
  name: string;
  path: string;
  schemaVersion: number;
  readOnly: boolean;
  assetCount: number;
  recentCount: number;
  unfiledCount: number;
  favoriteCount: number;
  duplicateCount: number;
  trashCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface NavigationCounts {
  all: number;
  recent: number;
  unfiled: number;
  favorites: number;
  duplicates: number;
  trash: number;
}

export interface Asset {
  id: string;
  displayName: string;
  extension: string;
  kind: AssetKind;
  mime: string;
  byteSize: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  rating: number;
  favorite: boolean;
  colorLabel?: string | null;
  dominantColor?: string | null;
  notes: string;
  sourcePath: string;
  importedAt: string;
  createdAt: string;
  deletedAt?: string | null;
  folderIds: string[];
  tags: Tag[];
  previewUrl?: string | null;
  assetUrl?: string | null;
  streamToken?: string | null;
  duplicateCount?: number;
}

export interface Folder {
  id: string;
  parentId?: string | null;
  name: string;
  itemCount: number;
  sortOrder: number;
  isEncrypted: boolean;
  isLocked: boolean;
  lockOwnerId?: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color?: string | null;
}

export interface SmartFolderQueryV1 {
  version: 1;
  operator: "and" | "or";
  rules: Array<{
    field:
      | "name"
      | "kind"
      | "tag"
      | "color"
      | "rating"
      | "size"
      | "duration"
      | "importedAt"
      | "unfiled"
      | "untagged";
    operator: "is" | "isNot" | "contains" | "gte" | "lte" | "before" | "after";
    value: string | number | boolean;
  }>;
}

export interface SmartFolder {
  id: string;
  name: string;
  query: SmartFolderQueryV1;
  itemCount: number;
}

export interface SearchQuery {
  text?: string;
  folderId?: string;
  kinds?: AssetKind[];
  tagIds?: string[];
  favorite?: boolean;
  minRating?: number;
  colorLabel?: string;
  unfiled?: boolean;
  untagged?: boolean;
  duplicates?: boolean;
  minByteSize?: number;
  maxByteSize?: number;
  importedAfter?: string;
  importedBefore?: string;
  aspectRatio?: "landscape" | "portrait" | "square";
  deleted?: boolean;
  sortBy?: "importedAt" | "createdAt" | "name" | "size" | "rating";
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface JobProgress {
  jobId: string;
  kind: "import" | "export" | "compact" | "update";
  completed: number;
  total: number;
  currentItem?: string;
  phase: "queued" | "running" | "complete" | "cancelled" | "failed";
  message?: string;
}

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "upToDate"; currentVersion: string }
  | { status: "available"; version: string; notes: string; size?: number }
  | { status: "downloading"; version: string; progress: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

export interface AssetPatch {
  displayName?: string;
  rating?: number;
  favorite?: boolean;
  colorLabel?: string | null;
  clearColorLabel?: boolean;
  notes?: string;
  tagIds?: string[];
  folderIds?: string[];
}

export interface ImportResult {
  jobId: string;
  imported: Asset[];
  duplicates: number;
  failed: Array<{ path: string; message: string }>;
  deletedOriginals: number;
  sourceDeleteFailures: Array<{ path: string; message: string }>;
}

export interface LanShareInfo {
  active: boolean;
  folderId?: string | null;
  folderName?: string | null;
  permission?: "readOnly" | "manage" | null;
  url?: string | null;
  port?: number | null;
}

export interface DiscoveredLanShare {
  id: string;
  deviceName: string;
  folderName: string;
  permission: "readOnly" | "manage";
  url: string;
}
