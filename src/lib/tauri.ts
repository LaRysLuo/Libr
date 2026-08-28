import type {
  Asset,
  AssetPatch,
  Folder,
  ImportResult,
  LibraryInfo,
  SearchQuery,
  SmartFolder,
  Tag,
} from "../types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauriRuntime = () => typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
};

export const libraryApi = {
  inspect: () => call<LibraryInfo | null>("library_inspect"),
  create: (path: string, name: string) => call<LibraryInfo>("library_create", { path, name }),
  open: (path: string) => call<LibraryInfo>("library_open", { path }),
  close: () => call<void>("library_close"),
  saveCopy: (path: string) => call<void>("library_save_copy", { path }),
  compact: () => call<LibraryInfo>("library_compact"),
  integrity: () => call<string[]>("library_integrity"),
};

export const assetApi = {
  list: (query: SearchQuery) => call<Asset[]>("asset_list", { query }),
  import: (paths: string[], folderId?: string) =>
    call<ImportResult>("asset_import", { paths, folderId: folderId ?? null }),
  cancelImport: (jobId: string) => call<void>("asset_cancel_import", { jobId }),
  update: (assetId: string, patch: AssetPatch) => call<Asset>("asset_update", { assetId, patch }),
  trash: (assetIds: string[]) => call<void>("asset_trash", { assetIds }),
  restore: (assetIds: string[]) => call<void>("asset_restore", { assetIds }),
  purge: (assetIds: string[]) => call<void>("asset_purge", { assetIds }),
  export: (assetIds: string[], destination: string) =>
    call<void>("asset_export", { assetIds, destination }),
  openExternal: (assetId: string) => call<void>("asset_open_external", { assetId }),
};

export const organizationApi = {
  folders: () => call<Folder[]>("folder_list"),
  assignAssets: (folderId: string, assetIds: string[]) =>
    call<number>("folder_assign_assets", { folderId, assetIds }),
  createFolder: (name: string, parentId?: string) =>
    call<Folder>("folder_create", { name, parentId: parentId ?? null }),
  updateFolder: (id: string, name: string, parentId?: string) =>
    call<Folder>("folder_update", { id, name, parentId: parentId ?? null }),
  deleteFolder: (id: string) => call<void>("folder_delete", { id }),
  tags: () => call<Tag[]>("tag_list"),
  createTag: (name: string, color?: string) => call<Tag>("tag_create", { name, color: color ?? null }),
  deleteTag: (id: string) => call<void>("tag_delete", { id }),
  smartFolders: () => call<SmartFolder[]>("smart_folder_list"),
  upsertSmartFolder: (name: string, query: SmartFolder["query"], id?: string) =>
    call<SmartFolder>("smart_folder_upsert", { id: id ?? null, name, query }),
  deleteSmartFolder: (id: string) => call<void>("smart_folder_delete", { id }),
};

export const assetProtocolUrl = (assetId: string, preview = false) => {
  const path = `${preview ? "preview" : "asset"}/${encodeURIComponent(assetId)}`;
  const windows = navigator.userAgent.toLowerCase().includes("windows");
  return windows ? `http://libr.localhost/${path}` : `libr://localhost/${path}`;
};
