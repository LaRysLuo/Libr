import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { mockAssets, mockFolders, mockSmartFolders } from "../data/mockAssets";
import { assetApi, assetProtocolUrl, isTauriRuntime, libraryApi, organizationApi } from "../lib/tauri";
import type { Asset, AssetKind, AssetPatch, Folder, JobProgress, LibraryInfo, NavigationCounts, SearchQuery, SmartFolder, Tag } from "../types";

const demoLibrary: LibraryInfo = {
  id: "demo-library",
  name: "我的素材",
  path: "我的素材.libr",
  schemaVersion: 1,
  readOnly: false,
  assetCount: 1268,
  recentCount: 342,
  unfiledCount: 18,
  favoriteCount: 214,
  duplicateCount: 12,
  trashCount: 36,
  totalBytes: 48_260_000_000,
  createdAt: "2026-01-16T10:00:00+08:00",
  updatedAt: "2026-08-28T09:42:00+08:00",
};

export type NavigationScope =
  | "all"
  | "recent"
  | "unfiled"
  | "favorites"
  | "duplicates"
  | "trash"
  | `folder:${string}`
  | `smart:${string}`;

export type SizeFilter = "all" | "small" | "medium" | "large";
export type DateFilter = "all" | "today" | "week" | "month";
export type AspectFilter = "all" | "landscape" | "portrait" | "square";

const mockTags = Array.from(new Map(mockAssets.flatMap((asset) => asset.tags).map((tag) => [tag.id, tag])).values());

const importedAfterFor = (filter: DateFilter | "recent") => {
  if (filter === "all") return undefined;
  const date = new Date();
  if (filter === "today") date.setHours(0, 0, 0, 0);
  else date.setDate(date.getDate() - (filter === "week" ? 7 : filter === "month" ? 30 : 30));
  return date.toISOString();
};

const smartFolderQuery = (folder?: SmartFolder): Partial<SearchQuery> => {
  if (!folder || folder.query.operator !== "and") return {};
  const query: Partial<SearchQuery> = {};
  for (const rule of folder.query.rules) {
    if (rule.field === "name" && rule.operator === "contains") query.text = String(rule.value);
    if (rule.field === "kind" && rule.operator === "is") query.kinds = [String(rule.value) as AssetKind];
    if (rule.field === "tag" && rule.operator === "is") query.tagIds = [String(rule.value)];
    if (rule.field === "color" && rule.operator === "is") query.colorLabel = String(rule.value);
    if (rule.field === "rating" && rule.operator === "gte") query.minRating = Number(rule.value);
    if (rule.field === "size" && rule.operator === "gte") query.minByteSize = Number(rule.value);
    if (rule.field === "size" && rule.operator === "lte") query.maxByteSize = Number(rule.value);
    if (rule.field === "unfiled" && rule.operator === "is") query.unfiled = Boolean(rule.value);
    if (rule.field === "untagged" && rule.operator === "is") query.untagged = Boolean(rule.value);
    if (rule.field === "importedAt" && rule.operator === "after") {
      const value = String(rule.value);
      query.importedAfter = importedAfterFor(value === "today" ? "today" : value === "week" ? "week" : "month");
    }
  }
  return query;
};

export function useLibraryController() {
  const [library, setLibrary] = useState<LibraryInfo | null>(isTauriRuntime() ? null : demoLibrary);
  const [assets, setAssets] = useState<Asset[]>(isTauriRuntime() ? [] : mockAssets);
  const [folders, setFolders] = useState<Folder[]>(isTauriRuntime() ? [] : mockFolders);
  const [smartFolders, setSmartFolders] = useState<SmartFolder[]>(isTauriRuntime() ? [] : mockSmartFolders);
  const [tags, setTags] = useState<Tag[]>(isTauriRuntime() ? [] : mockTags);
  const [scope, setScope] = useState<NavigationScope>("all");
  const [searchText, setSearchText] = useState("");
  const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
  const [minimumRating, setMinimumRating] = useState(0);
  const [tagFilter, setTagFilter] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [colorFilter, setColorFilter] = useState("");
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [aspectFilter, setAspectFilter] = useState<AspectFilter>("all");
  const [sortBy, setSortBy] = useState<SearchQuery["sortBy"]>("importedAt");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(isTauriRuntime() ? [] : mockAssets.slice(0, 1).map((item) => item.id)));
  const [loading, setLoading] = useState(isTauriRuntime());
  const [activeJobs, setActiveJobs] = useState(0);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(searchText.trim().toLocaleLowerCase("zh-CN"));

  const loadOrganization = useCallback(async () => {
    const [nextFolders, nextSmartFolders, nextTags] = await Promise.all([
      organizationApi.folders(),
      organizationApi.smartFolders(),
      organizationApi.tags(),
    ]);
    setFolders(nextFolders);
    setSmartFolders(nextSmartFolders);
    setTags(nextTags);
  }, []);

  const reloadAssets = useCallback(async (override?: Partial<SearchQuery>) => {
    if (!isTauriRuntime()) return;
    const folderId = scope.startsWith("folder:") ? scope.slice(7) : undefined;
    const selectedSmartFolder = scope.startsWith("smart:") ? smartFolders.find((item) => item.id === scope.slice(6)) : undefined;
    const [minByteSize, maxByteSize] = sizeFilter === "small" ? [undefined, 1_000_000] : sizeFilter === "medium" ? [1_000_000, 20_000_000] : sizeFilter === "large" ? [20_000_000, undefined] : [undefined, undefined];
    const query: SearchQuery = {
      text: deferredSearch || undefined,
      folderId: folderFilter || folderId,
      kinds: kindFilter === "all" ? undefined : [kindFilter],
      tagIds: tagFilter ? [tagFilter] : undefined,
      colorLabel: colorFilter || undefined,
      favorite: scope === "favorites" ? true : undefined,
      deleted: scope === "trash",
      unfiled: scope === "unfiled" ? true : undefined,
      duplicates: scope === "duplicates" ? true : undefined,
      minRating: minimumRating || undefined,
      minByteSize,
      maxByteSize,
      importedAfter: scope === "recent" ? importedAfterFor("recent") : importedAfterFor(dateFilter),
      aspectRatio: aspectFilter === "all" ? undefined : aspectFilter,
      sortBy,
      sortDirection: sortBy === "name" ? "asc" : "desc",
      limit: 5000,
      ...smartFolderQuery(selectedSmartFolder),
      ...override,
    };
    setLoading(true);
    try {
      const nextAssets = (await assetApi.list(query)).map((asset) => ({
        ...asset,
        previewUrl: asset.previewUrl && asset.streamToken ? assetProtocolUrl(asset.streamToken, true) : null,
        assetUrl: asset.streamToken ? assetProtocolUrl(asset.streamToken, false) : null,
      }));
      startTransition(() => setAssets(nextAssets));
      setSelectedIds((previous) => {
        const visibleIds = new Set(nextAssets.map((asset) => asset.id));
        return new Set([...previous].filter((id) => visibleIds.has(id)));
      });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }, [aspectFilter, colorFilter, dateFilter, deferredSearch, folderFilter, kindFilter, minimumRating, scope, sizeFilter, smartFolders, sortBy, tagFilter]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    libraryApi.inspect()
      .then((info) => {
        if (!active) return;
        setLibrary(info);
      })
      .catch((reason) => active && setError(String(reason)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => listen<JobProgress>("job-progress", ({ payload }) => setJobProgress(payload))).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!jobProgress || jobProgress.phase === "running" || jobProgress.phase === "queued") return;
    const timer = window.setTimeout(() => setJobProgress(null), 1800);
    return () => window.clearTimeout(timer);
  }, [jobProgress]);

  useEffect(() => {
    if (!isTauriRuntime() || !library) return;
    void reloadAssets();
  }, [deferredSearch, kindFilter, library?.id, minimumRating, reloadAssets, scope, sortBy]);

  useEffect(() => {
    if (!isTauriRuntime() || !library) return;
    void loadOrganization();
  }, [library?.id, loadOrganization]);

  const visibleAssets = useMemo(() => {
    if (isTauriRuntime()) return assets;
    const filtered = assets.filter((asset) => {
      if (scope === "favorites" && !asset.favorite) return false;
      if (scope === "trash" && !asset.deletedAt) return false;
      if (scope !== "trash" && asset.deletedAt) return false;
      if (scope === "unfiled" && asset.folderIds.length > 0) return false;
      if (scope === "duplicates" && !asset.duplicateCount) return false;
      if (scope.startsWith("folder:") && !asset.folderIds.includes(scope.slice(7))) return false;
      if (folderFilter && !asset.folderIds.includes(folderFilter)) return false;
      if (tagFilter && !asset.tags.some((tag) => tag.id === tagFilter)) return false;
      if (colorFilter && asset.colorLabel !== colorFilter) return false;
      if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
      if (minimumRating > 0 && asset.rating < minimumRating) return false;
      if (sizeFilter === "small" && asset.byteSize > 1_000_000) return false;
      if (sizeFilter === "medium" && (asset.byteSize < 1_000_000 || asset.byteSize > 20_000_000)) return false;
      if (sizeFilter === "large" && asset.byteSize < 20_000_000) return false;
      const importedAfter = scope === "recent" ? importedAfterFor("recent") : importedAfterFor(dateFilter);
      if (importedAfter && asset.importedAt < importedAfter) return false;
      if (aspectFilter !== "all") {
        if (!asset.width || !asset.height) return false;
        if (aspectFilter === "landscape" && asset.width <= asset.height) return false;
        if (aspectFilter === "portrait" && asset.width >= asset.height) return false;
        if (aspectFilter === "square" && Math.abs(asset.width - asset.height) / Math.max(asset.width, asset.height) > 0.05) return false;
      }
      if (!deferredSearch) return true;
      const searchable = [asset.displayName, asset.notes, asset.sourcePath, ...asset.tags.map((item) => item.name)]
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      return searchable.includes(deferredSearch);
    });
    return [...filtered].sort((left, right) => {
      const direction = sortBy === "name" ? 1 : -1;
      if (sortBy === "name") return left.displayName.localeCompare(right.displayName, "zh-CN") * direction;
      if (sortBy === "size") return (left.byteSize - right.byteSize) * direction;
      if (sortBy === "rating") return (left.rating - right.rating) * direction;
      const leftDate = sortBy === "createdAt" ? left.createdAt : left.importedAt;
      const rightDate = sortBy === "createdAt" ? right.createdAt : right.importedAt;
      return leftDate.localeCompare(rightDate) * direction;
    });
  }, [aspectFilter, assets, colorFilter, dateFilter, deferredSearch, folderFilter, kindFilter, minimumRating, scope, sizeFilter, sortBy, tagFilter]);

  const selectedAssets = useMemo(() => visibleAssets.filter((asset) => selectedIds.has(asset.id)), [selectedIds, visibleAssets]);
  const primaryAsset = selectedAssets.at(-1) ?? null;
  const navigationCounts: NavigationCounts = {
    all: library?.assetCount ?? 0,
    recent: library?.recentCount ?? 0,
    unfiled: library?.unfiledCount ?? 0,
    favorites: library?.favoriteCount ?? 0,
    duplicates: library?.duplicateCount ?? 0,
    trash: library?.trashCount ?? 0,
  };

  const selectAsset = useCallback((id: string, additive = false, range = false) => {
    setSelectedIds((previous) => {
      if (range && previous.size > 0) {
        const ids = visibleAssets.map((item) => item.id);
        const anchor = ids.findIndex((item) => previous.has(item));
        const target = ids.indexOf(id);
        if (anchor >= 0 && target >= 0) {
          const [from, to] = anchor < target ? [anchor, target] : [target, anchor];
          return new Set(additive ? [...previous, ...ids.slice(from, to + 1)] : ids.slice(from, to + 1));
        }
      }
      if (additive) {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }
      return new Set([id]);
    });
  }, [visibleAssets]);

  const updateAsset = useCallback(async (assetId: string, patch: AssetPatch) => {
    setAssets((current) => current.map((asset) => {
      if (asset.id !== assetId) return asset;
      const next: Asset = { ...asset, ...patch };
      if (patch.tagIds) next.tags = tags.filter((tag) => patch.tagIds?.includes(tag.id));
      if (patch.clearColorLabel) next.colorLabel = null;
      return next;
    }));
    if (!isTauriRuntime()) return;
    try {
      const updated = await assetApi.update(assetId, patch);
      setAssets((current) => current.map((asset) => asset.id === assetId ? {
        ...updated,
        previewUrl: updated.previewUrl && updated.streamToken ? assetProtocolUrl(updated.streamToken, true) : null,
        assetUrl: updated.streamToken ? assetProtocolUrl(updated.streamToken, false) : null,
      } : asset));
    } catch (reason) {
      setError(String(reason));
      await reloadAssets();
    }
  }, [reloadAssets, tags]);

  const openLibrary = useCallback(async (path: string) => {
    const info = await libraryApi.open(path);
    setLibrary(info);
    await Promise.all([reloadAssets({}), loadOrganization()]);
  }, [loadOrganization, reloadAssets]);

  const createLibrary = useCallback(async (path: string) => {
    const filename = path.split(/[\\/]/).pop()?.replace(/\.libr$/i, "") || "我的素材";
    const normalizedPath = /\.libr$/i.test(path) ? path : `${path}.libr`;
    const info = await libraryApi.create(normalizedPath, filename);
    setLibrary(info);
    setAssets([]);
    setFolders([]);
    setSmartFolders([]);
  }, []);

  const importPaths = useCallback(async (paths: string[], folderId?: string) => {
    setActiveJobs((count) => count + 1);
    try {
      const result = await assetApi.import(paths, folderId);
      await reloadAssets();
      if (isTauriRuntime()) setLibrary(await libraryApi.inspect());
      return result;
    } finally {
      setActiveJobs((count) => Math.max(0, count - 1));
    }
  }, [reloadAssets]);

  const createFolder = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (isTauriRuntime()) {
      await organizationApi.createFolder(trimmed);
      await loadOrganization();
    } else {
      setFolders((current) => [...current, { id: `folder-${crypto.randomUUID()}`, name: trimmed, itemCount: 0, sortOrder: current.length }]);
    }
  }, [loadOrganization]);

  const createSmartFolder = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const query: SmartFolder["query"] = { version: 1, operator: "and", rules: [] };
    if (isTauriRuntime()) {
      await organizationApi.upsertSmartFolder(trimmed, query);
      await loadOrganization();
    } else {
      setSmartFolders((current) => [...current, { id: `smart-${crypto.randomUUID()}`, name: trimmed, query, itemCount: 0 }]);
    }
  }, [loadOrganization]);

  const trashAssets = useCallback(async (assetIds: string[]) => {
    const deletedAt = new Date().toISOString();
    setAssets((current) => current.map((asset) => assetIds.includes(asset.id) ? { ...asset, deletedAt } : asset));
    setSelectedIds(new Set());
    if (isTauriRuntime()) await assetApi.trash(assetIds);
  }, []);

  const restoreAssets = useCallback(async (assetIds: string[]) => {
    setAssets((current) => current.map((asset) => assetIds.includes(asset.id) ? { ...asset, deletedAt: null } : asset));
    setSelectedIds(new Set());
    if (isTauriRuntime()) {
      await assetApi.restore(assetIds);
      await reloadAssets();
    }
  }, [reloadAssets]);

  const purgeAssets = useCallback(async (assetIds: string[]) => {
    setAssets((current) => current.filter((asset) => !assetIds.includes(asset.id)));
    setSelectedIds(new Set());
    if (isTauriRuntime()) {
      await assetApi.purge(assetIds);
      await reloadAssets();
      setLibrary(await libraryApi.inspect());
    }
  }, [reloadAssets]);

  const exportAssets = useCallback(async (assetIds: string[], destination: string) => {
    setActiveJobs((count) => count + 1);
    try {
      await assetApi.export(assetIds, destination);
    } finally {
      setActiveJobs((count) => Math.max(0, count - 1));
    }
  }, []);

  const compactLibrary = useCallback(async () => {
    setActiveJobs((count) => count + 1);
    try {
      const info = await libraryApi.compact();
      setLibrary(info);
      await reloadAssets();
      return info;
    } finally {
      setActiveJobs((count) => Math.max(0, count - 1));
    }
  }, [reloadAssets]);

  const checkIntegrity = useCallback(() => libraryApi.integrity(), []);

  const cancelJob = useCallback(async () => {
    if (jobProgress?.kind === "import") await assetApi.cancelImport(jobProgress.jobId);
  }, [jobProgress]);

  return {
    library,
    assets: visibleAssets,
    folders,
    smartFolders,
    tags,
    navigationCounts,
    selectedIds,
    selectedAssets,
    primaryAsset,
    scope,
    searchText,
    kindFilter,
    minimumRating,
    tagFilter,
    folderFilter,
    colorFilter,
    sizeFilter,
    dateFilter,
    aspectFilter,
    sortBy,
    loading,
    activeJobs,
    jobProgress,
    error,
    setScope,
    setSearchText,
    setKindFilter,
    setMinimumRating,
    setTagFilter,
    setFolderFilter,
    setColorFilter,
    setSizeFilter,
    setDateFilter,
    setAspectFilter,
    setSortBy,
    setError,
    selectAsset,
    setSelectedIds,
    updateAsset,
    openLibrary,
    createLibrary,
    importPaths,
    createFolder,
    createSmartFolder,
    trashAssets,
    restoreAssets,
    purgeAssets,
    exportAssets,
    compactLibrary,
    checkIntegrity,
    cancelJob,
    reloadAssets,
  };
}
