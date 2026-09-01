import { AlertCircle, CheckCircle2, Copy, Database, FilePlus2, FolderOpen, RefreshCw, Save, Settings, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { AssetGrid } from "./components/AssetGrid";
import { FilterBar } from "./components/FilterBar";
import { FocusPreview } from "./components/FocusPreview";
import { Inspector } from "./components/Inspector";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { UpdateDialog } from "./components/UpdateDialog";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { useLibraryController } from "./hooks/useLibraryController";
import { assetApi, isTauriRuntime, libraryApi } from "./lib/tauri";
import type { Asset } from "./types";

interface ToastState {
  kind: "success" | "error" | "info";
  message: string;
}

async function chooseLibraryToOpen() {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open({ multiple: false, directory: false, filters: [{ name: "Libr 资源库", extensions: ["libr"] }] });
}

async function chooseLibraryToCreate() {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath: "我的素材.libr", filters: [{ name: "Libr 资源库", extensions: ["libr"] }] });
}

function App() {
  const controller = useLibraryController();
  const updater = useAppUpdater(controller.activeJobs, controller.library?.path);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [thumbnailSize, setThumbnailSize] = useState(164);
  const [focusAsset, setFocusAsset] = useState<Asset | null>(null);
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const selectedBytes = useMemo(() => controller.selectedAssets.reduce((sum, item) => sum + item.byteSize, 0), [controller.selectedAssets]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isTauriRuntime() || !controller.library) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => {
      getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          const paths = event.payload.paths.filter(Boolean);
          if (paths.length === 0) return;
          void controller.importPaths(paths).then((result) => {
            setToast({ kind: "success", message: `已导入 ${result.imported.length} 项，跳过 ${result.duplicates} 个重复项` });
          }).catch((reason) => setToast({ kind: "error", message: String(reason) }));
        }
      }).then((dispose) => { unlisten = dispose; });
    });
    return () => unlisten?.();
  }, [controller.importPaths, controller.library]);

  const createLibrary = async () => {
    if (!isTauriRuntime()) {
      setToast({ kind: "info", message: "当前为浏览器预览；桌面版会创建真正的 .libr 文件。" });
      return;
    }
    const path = await chooseLibraryToCreate();
    if (path) await controller.createLibrary(path);
  };

  const openLibrary = async () => {
    if (!isTauriRuntime()) {
      setToast({ kind: "info", message: "当前为浏览器预览；桌面版会打开本地 .libr 文件。" });
      return;
    }
    const path = await chooseLibraryToOpen();
    if (typeof path === "string") await controller.openLibrary(path);
  };

  const importAssets = async () => {
    if (!isTauriRuntime()) {
      setToast({ kind: "success", message: "导入入口工作正常；桌面版会流式写入当前资源库。" });
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const paths = await open({ multiple: true, directory: false });
    if (!paths) return;
    const list = typeof paths === "string" ? [paths] : paths;
    const result = await controller.importPaths(list);
    setToast({ kind: "success", message: `已导入 ${result.imported.length} 项，跳过 ${result.duplicates} 个重复项` });
  };

  const saveCopy = async () => {
    if (!isTauriRuntime()) {
      setToast({ kind: "info", message: "桌面版会通过 SQLite 在线备份创建完整副本。" });
      return;
    }
    const path = await chooseLibraryToCreate();
    if (!path) return;
    await libraryApi.saveCopy(path);
    setToast({ kind: "success", message: "资源库副本已保存" });
  };

  const openExternal = async (asset: Asset) => {
    if (!isTauriRuntime()) {
      setToast({ kind: "info", message: `桌面版会只读打开“${asset.displayName}”` });
      return;
    }
    await assetApi.openExternal(asset.id);
  };

  const exportSelection = async (assets: Asset[]) => {
    if (!assets.length) return;
    if (!isTauriRuntime()) {
      setToast({ kind: "success", message: assets.length === 1 ? `“${assets[0].displayName}”导出入口工作正常` : `已准备导出 ${assets.length} 项资源` });
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const destination = await open({ directory: true, multiple: false });
    if (typeof destination !== "string") return;
    await controller.exportAssets(assets.map((asset) => asset.id), destination);
    setToast({ kind: "success", message: assets.length === 1 ? `已导出“${assets[0].displayName}”` : `已导出 ${assets.length} 项资源` });
  };

  const assignAssetsToFolder = useCallback(async (assetIds: string[], folderId: string) => {
    const folder = controller.folders.find((item) => item.id === folderId);
    const assigned = await controller.assignAssetsToFolder(assetIds, folderId);
    setToast({
      kind: "success",
      message: assigned > 0
        ? `已将 ${assigned} 项资源添加到“${folder?.name ?? "文件夹"}”`
        : `所选资源已在“${folder?.name ?? "文件夹"}”中`,
    });
  }, [controller.assignAssetsToFolder, controller.folders]);

  const moveAssetsToTrash = useCallback((assets: Asset[]) => {
    void controller.trashAssets(assets.map((asset) => asset.id));
    setToast({ kind: "success", message: assets.length === 1 ? `“${assets[0].displayName}”已移到回收站` : `${assets.length} 项资源已移到回收站` });
  }, [controller.trashAssets]);

  const permanentlyDeleteAssets = useCallback((assets: Asset[]) => {
    if (!window.confirm(assets.length === 1 ? `将永久删除“${assets[0].displayName}”，此操作无法撤销。` : `将永久删除所选 ${assets.length} 项资源，此操作无法撤销。`)) return;
    void controller.purgeAssets(assets.map((asset) => asset.id));
    setToast({ kind: "success", message: assets.length === 1 ? `“${assets[0].displayName}”已永久删除` : `${assets.length} 项资源已永久删除` });
  }, [controller.purgeAssets]);

  const deleteAssets = useCallback((assets: Asset[]) => {
    if (assets.every((asset) => Boolean(asset.deletedAt))) permanentlyDeleteAssets(assets);
    else moveAssetsToTrash(assets);
  }, [moveAssetsToTrash, permanentlyDeleteAssets]);

  const inspectIntegrity = async () => {
    setLibraryMenuOpen(false);
    if (!isTauriRuntime()) {
      setToast({ kind: "success", message: "资源库完整性检查通过" });
      return;
    }
    const result = await controller.checkIntegrity();
    setToast(result.length === 1 && result[0] === "ok" ? { kind: "success", message: "资源库完整性检查通过" } : { kind: "error", message: `发现问题：${result.join("；")}` });
  };

  const compactLibrary = async () => {
    setLibraryMenuOpen(false);
    if (!isTauriRuntime()) {
      setToast({ kind: "success", message: "资源库压缩入口工作正常" });
      return;
    }
    await controller.compactLibrary();
    setToast({ kind: "success", message: "资源库压缩完成" });
  };

  const handleErrorDismiss = () => {
    controller.setError(null);
  };

  const visibleError = controller.error;

  if (!controller.library) {
    return (
      <div className="app-root welcome-root">
        <WelcomeScreen onCreate={() => void createLibrary()} onOpen={() => void openLibrary()} />
        {visibleError ? <div className="error-banner"><AlertCircle size={16} />{visibleError}<button onClick={handleErrorDismiss}><X size={14} /></button></div> : null}
      </div>
    );
  }

  return (
    <div className={`app-root ${sidebarVisible ? "has-sidebar" : ""} ${inspectorVisible ? "has-inspector" : ""}`}>
      <AppHeader
        library={controller.library}
        searchText={controller.searchText}
        sortBy={controller.sortBy}
        viewMode={viewMode}
        onSearch={controller.setSearchText}
        onImport={() => void importAssets()}
        onSort={controller.setSortBy}
        onViewMode={setViewMode}
        onToggleFilters={() => setFiltersExpanded((value) => !value)}
        onToggleSidebar={() => setSidebarVisible((value) => !value)}
        onLibraryMenu={() => { setAppMenuOpen(false); setLibraryMenuOpen((value) => !value); }}
        onAppMenu={() => { setLibraryMenuOpen(false); setAppMenuOpen((value) => !value); }}
      />

      {libraryMenuOpen ? (
        <div className="library-menu">
          <button type="button" onClick={() => { setLibraryMenuOpen(false); void createLibrary(); }}><FilePlus2 size={15} />新建资源库<kbd>⌘N</kbd></button>
          <button type="button" onClick={() => { setLibraryMenuOpen(false); void openLibrary(); }}><FolderOpen size={15} />打开资源库<kbd>⌘O</kbd></button>
          <button type="button" onClick={() => { setLibraryMenuOpen(false); void saveCopy(); }}><Copy size={15} />另存副本…</button>
          <button type="button" onClick={() => void inspectIntegrity()}><ShieldCheck size={15} />检查资源库完整性</button>
          <button type="button" onClick={() => void compactLibrary()} disabled={controller.activeJobs > 0}><Database size={15} />压缩资源库</button>
        </div>
      ) : null}

      {appMenuOpen ? (
        <div className="library-menu app-menu">
          <button type="button" onClick={() => { setAppMenuOpen(false); void updater.checkForUpdates(true); }}><RefreshCw size={15} />检查更新…</button>
          <button type="button" disabled title="偏好设置将在后续版本开放"><Settings size={15} />偏好设置<kbd>⌘,</kbd></button>
        </div>
      ) : null}

      <div className="workspace">
        {sidebarVisible ? (
          <Sidebar
            scope={controller.scope}
            folders={controller.folders}
            smartFolders={controller.smartFolders}
            counts={controller.navigationCounts}
            onScope={controller.setScope}
            onCreateFolder={controller.createFolder}
            onCreateSmartFolder={controller.createSmartFolder}
            onAssignAssets={assignAssetsToFolder}
          />
        ) : null}

        <main className="content-pane">
          <FilterBar
            kind={controller.kindFilter}
            rating={controller.minimumRating}
            tags={controller.tags}
            folders={controller.folders}
            tagId={controller.tagFilter}
            folderId={controller.folderFilter}
            color={controller.colorFilter}
            size={controller.sizeFilter}
            date={controller.dateFilter}
            aspect={controller.aspectFilter}
            expanded={filtersExpanded}
            onKind={controller.setKindFilter}
            onRating={controller.setMinimumRating}
            onTag={controller.setTagFilter}
            onFolder={controller.setFolderFilter}
            onColor={controller.setColorFilter}
            onSize={controller.setSizeFilter}
            onDate={controller.setDateFilter}
            onAspect={controller.setAspectFilter}
            onMore={() => setFiltersExpanded(true)}
            onReset={() => { controller.setKindFilter("all"); controller.setMinimumRating(0); controller.setTagFilter(""); controller.setFolderFilter(""); controller.setColorFilter(""); controller.setSizeFilter("all"); controller.setDateFilter("all"); controller.setAspectFilter("all"); }}
          />
          <AssetGrid
            assets={controller.assets}
            selectedIds={controller.selectedIds}
            viewMode={viewMode}
            thumbnailSize={thumbnailSize}
            loading={controller.loading}
            onSelect={controller.selectAsset}
            onOpen={setFocusAsset}
            onToggleFavorite={(asset) => void controller.updateAsset(asset.id, { favorite: !asset.favorite })}
            onAssignAssets={assignAssetsToFolder}
            onDelete={deleteAssets}
          />
        </main>

        {inspectorVisible ? (
          <Inspector
            assets={controller.selectedAssets}
            availableTags={controller.tags}
            folders={controller.folders}
            onUpdate={(assetIds, patch) => void controller.updateAssets(assetIds, patch)}
            onCreateTag={controller.createTag}
            onOpenExternal={(asset) => void openExternal(asset)}
            onTrash={moveAssetsToTrash}
            onRestore={(assets) => { void controller.restoreAssets(assets.map((asset) => asset.id)); setToast({ kind: "success", message: assets.length === 1 ? `“${assets[0].displayName}”已恢复` : `${assets.length} 项资源已恢复` }); }}
            onPurge={permanentlyDeleteAssets}
            onExport={(assets) => void exportSelection(assets)}
          />
        ) : null}
      </div>

      <StatusBar
        selectedCount={controller.selectedIds.size}
        selectedBytes={selectedBytes}
        totalCount={controller.assets.length}
        thumbnailSize={thumbnailSize}
        inspectorVisible={inspectorVisible}
        jobProgress={controller.jobProgress}
        onThumbnailSize={setThumbnailSize}
        onInspectorVisible={setInspectorVisible}
        onCancelJob={() => void controller.cancelJob()}
      />

      {focusAsset ? (
        <FocusPreview
          asset={focusAsset}
          assets={controller.assets}
          onClose={() => setFocusAsset(null)}
          onNavigate={setFocusAsset}
          onFavorite={(asset) => {
            void controller.updateAsset(asset.id, { favorite: !asset.favorite });
            setFocusAsset({ ...asset, favorite: !asset.favorite });
          }}
        />
      ) : null}

      <UpdateDialog
        state={updater.state}
        onDismiss={updater.dismiss}
        onSkip={updater.skip}
        onInstall={() => void updater.install()}
        onCheck={() => void updater.checkForUpdates(true)}
      />

      {visibleError ? <div className="error-banner"><AlertCircle size={16} />{visibleError}<button onClick={handleErrorDismiss}><X size={14} /></button></div> : null}
      {toast ? (
        <div className={`toast toast-${toast.kind}`}>
          {toast.kind === "success" ? <CheckCircle2 size={16} /> : toast.kind === "error" ? <AlertCircle size={16} /> : <Save size={16} />}
          <span>{toast.message}</span><button type="button" aria-label="关闭" onClick={() => setToast(null)}><X size={13} /></button>
        </div>
      ) : null}
    </div>
  );
}

export default App;
