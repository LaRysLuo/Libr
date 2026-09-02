import { AlertCircle, CheckCircle2, Copy, Database, FilePlus2, FolderOpen, Moon, RefreshCw, Save, Settings, ShieldCheck, Sun, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { AssetGrid } from "./components/AssetGrid";
import { FilterBar } from "./components/FilterBar";
import { FocusPreview } from "./components/FocusPreview";
import { FolderPasswordDialog, type FolderPasswordMode } from "./components/FolderPasswordDialog";
import { ImportSettingsDialog, type ImportSettings } from "./components/ImportSettingsDialog";
import { Inspector } from "./components/Inspector";
import { LanShareDialog } from "./components/LanShareDialog";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { UpdateDialog } from "./components/UpdateDialog";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { useDismissibleLayer } from "./hooks/useDismissibleLayer";
import { useLibraryController } from "./hooks/useLibraryController";
import { useLanShareDiscovery } from "./hooks/useLanShareDiscovery";
import { shouldIgnoreNativeAssetDrop } from "./lib/drag";
import { assetApi, isTauriRuntime, lanShareApi, libraryApi } from "./lib/tauri";
import type { Asset, DiscoveredLanShare, Folder, ImportMode, LanShareInfo } from "./types";

interface ToastState {
  kind: "success" | "error" | "info";
  message: string;
}

interface FolderPasswordState {
  folder: Folder;
  mode: FolderPasswordMode;
  openFolderId?: string;
}

type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "libr:theme";
const IMPORT_SETTINGS_STORAGE_KEY = "libr:import-settings";
const inactiveLanShare: LanShareInfo = { active: false };

function getInitialTheme(): Theme {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") return storedTheme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialImportSettings(): ImportSettings {
  try {
    const stored = JSON.parse(window.localStorage.getItem(IMPORT_SETTINGS_STORAGE_KEY) ?? "null") as ({ mode?: ImportMode; deleteOriginals?: boolean }) | null;
    if (stored?.mode === "map" || stored?.mode === "copy" || stored?.mode === "move") return { mode: stored.mode };
    if (stored?.deleteOriginals === true) return { mode: "move" };
    return { mode: "map" };
  } catch {
    return { mode: "map" };
  }
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
  const { shares: discoveredLanShares } = useLanShareDiscovery();
  const updater = useAppUpdater(controller.activeJobs, controller.library?.path);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [thumbnailSize, setThumbnailSize] = useState(164);
  const [focusAsset, setFocusAsset] = useState<Asset | null>(null);
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const libraryMenuRef = useRef<HTMLDivElement>(null);
  const libraryMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const appMenuRef = useRef<HTMLDivElement>(null);
  const appMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [folderPassword, setFolderPassword] = useState<FolderPasswordState | null>(null);
  const [lanShareFolderId, setLanShareFolderId] = useState<string | null>(null);
  const [lanShareInfo, setLanShareInfo] = useState<LanShareInfo>(inactiveLanShare);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [importSettings, setImportSettings] = useState<ImportSettings>(getInitialImportSettings);
  const [importSettingsOpen, setImportSettingsOpen] = useState(false);
  const selectedBytes = useMemo(() => controller.selectedAssets.reduce((sum, item) => sum + item.byteSize, 0), [controller.selectedAssets]);

  useDismissibleLayer({
    open: libraryMenuOpen,
    layerRef: libraryMenuRef,
    triggerRef: libraryMenuTriggerRef,
    onDismiss: () => setLibraryMenuOpen(false),
  });
  useDismissibleLayer({
    open: appMenuOpen,
    layerRef: appMenuRef,
    triggerRef: appMenuTriggerRef,
    onDismiss: () => setAppMenuOpen(false),
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

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
          if (shouldIgnoreNativeAssetDrop(paths)) return;
          void controller.importPaths(paths, undefined, importSettings.mode).then((result) => {
            setToast({ kind: "success", message: `${importSettings.mode === "map" ? "已映射" : "已导入"} ${result.imported.length} 项，跳过 ${result.duplicates} 个重复项` });
          }).catch((reason) => setToast({ kind: "error", message: String(reason) }));
        }
      }).then((dispose) => { unlisten = dispose; });
    });
    return () => unlisten?.();
  }, [controller.importPaths, controller.library, importSettings.mode]);

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

  const importAssets = async (source: "files" | "folder") => {
    const { mode } = importSettings;
    if (!isTauriRuntime()) {
      setToast({
        kind: "success",
        message: mode === "move"
          ? "剪切导入入口工作正常；桌面版只会删除新导入成功的原文件，重复项会保留。"
          : mode === "map"
          ? source === "folder"
            ? "文件夹映射导入入口工作正常；桌面版会映射所选文件夹及其所有子文件夹中的文件，不会复制文件内容。"
            : "映射导入入口工作正常；桌面版只保存原文件路径和缩略图，不会复制文件内容。"
          : source === "folder"
          ? "文件夹导入入口工作正常；桌面版会导入所选文件夹及其所有子文件夹中的文件。"
          : "导入入口工作正常；桌面版会流式写入当前资源库。",
      });
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const paths = await open({ multiple: source === "files", directory: source === "folder" });
    if (!paths) return;
    const list = typeof paths === "string" ? [paths] : paths;
    const result = await controller.importPaths(list, undefined, mode);
    if (mode === "move") {
      const deleteFailures = result.sourceDeleteFailures.length;
      setToast({
        kind: deleteFailures ? "info" : "success",
        message: `已剪切导入 ${result.imported.length} 项，删除 ${result.deletedOriginals} 个原文件${result.duplicates ? `，保留 ${result.duplicates} 个重复项` : ""}${deleteFailures ? `，${deleteFailures} 个原文件无法删除` : ""}`,
      });
      return;
    }
    if (mode === "map") {
      setToast({ kind: "success", message: `已映射 ${result.imported.length} 项，跳过 ${result.duplicates} 个重复项；原文件内容未复制` });
      return;
    }
    setToast({ kind: "success", message: `已导入 ${result.imported.length} 项，跳过 ${result.duplicates} 个重复项` });
  };

  const saveImportSettings = useCallback((settings: ImportSettings) => {
    setImportSettings(settings);
    window.localStorage.setItem(IMPORT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    setImportSettingsOpen(false);
    setToast({ kind: "success", message: settings.mode === "map" ? "导入已设为映射模式" : settings.mode === "move" ? "导入已设为剪切模式" : "导入已设为复制模式" });
  }, []);

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

  const openLanShare = useCallback(async (folder: Folder) => {
    setLanShareFolderId(folder.id);
    if (!isTauriRuntime()) return;
    try {
      setLanShareInfo(await lanShareApi.status());
    } catch (reason) {
      setToast({ kind: "error", message: String(reason) });
    }
  }, []);

  const startLanShare = async (folderId: string, allowEditing: boolean) => {
    if (!isTauriRuntime()) {
      const folder = controller.folders.find((item) => item.id === folderId);
      const demoInfo: LanShareInfo = {
        active: true,
        folderId,
        folderName: folder?.name ?? "共享文件夹",
        permission: allowEditing ? "manage" : "readOnly",
        url: "http://192.168.1.23:41783/share/demo-access-token",
        port: 41783,
      };
      setLanShareInfo(demoInfo);
      return demoInfo;
    }
    const info = await lanShareApi.start(folderId, allowEditing);
    setLanShareInfo(info);
    setToast({ kind: "success", message: `已开始共享“${info.folderName ?? "文件夹"}”` });
    return info;
  };

  const stopLanShare = async () => {
    if (isTauriRuntime()) await lanShareApi.stop();
    setLanShareInfo(inactiveLanShare);
    setToast({ kind: "success", message: "局域网共享已停止" });
  };

  const openDiscoveredLanShare = useCallback((share: DiscoveredLanShare) => {
    if (!isTauriRuntime()) {
      setToast({ kind: "info", message: `桌面版会在浏览器中打开“${share.folderName}”` });
      return;
    }
    void lanShareApi.open(share.id)
      .catch((reason) => setToast({ kind: "error", message: String(reason) }));
  }, []);

  const openExternal = async (asset: Asset) => {
    if (!isTauriRuntime()) {
      setToast({ kind: "info", message: `桌面版会在外部应用中打开“${asset.displayName}”` });
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

  const openFolder = useCallback((folder: Folder) => {
    if (!folder.isLocked) {
      controller.setScope(`folder:${folder.id}`);
      return;
    }
    const lockOwner = controller.folders.find((item) => item.id === folder.lockOwnerId) ?? folder;
    setFolderPassword({ folder: lockOwner, mode: "unlock", openFolderId: folder.id });
  }, [controller.folders, controller.setScope]);

  const handleFolderSecurity = useCallback((folder: Folder, action: FolderPasswordMode | "lock") => {
    if (action === "lock") {
      controller.setScope("all");
      void controller.lockFolder(folder.id)
        .then(() => setToast({ kind: "success", message: `“${folder.name}”已锁定` }))
        .catch((reason) => setToast({ kind: "error", message: String(reason) }));
      return;
    }
    setFolderPassword({ folder, mode: action });
  }, [controller.lockFolder, controller.setScope]);

  const submitFolderPassword = useCallback(async (password: string) => {
    if (!folderPassword) return false;
    const { folder, mode, openFolderId } = folderPassword;
    if (mode === "encrypt") {
      controller.setScope("all");
      const encrypted = await controller.encryptFolder(folder.id, password);
      if (encrypted) {
        setFolderPassword(null);
        setToast({ kind: "success", message: `“${folder.name}”已加密并锁定` });
      }
      return encrypted;
    }
    if (mode === "unlock") {
      const unlocked = await controller.unlockFolder(folder.id, password);
      if (unlocked) {
        setFolderPassword(null);
        controller.setScope(`folder:${openFolderId ?? folder.id}`);
        setToast({ kind: "success", message: `“${folder.name}”已解锁` });
      }
      return unlocked;
    }
    const removed = await controller.removeFolderEncryption(folder.id, password);
    if (removed) {
      setFolderPassword(null);
      setToast({ kind: "success", message: `已取消“${folder.name}”的加密` });
    }
    return removed;
  }, [controller.encryptFolder, controller.removeFolderEncryption, controller.setScope, controller.unlockFolder, folderPassword]);

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
        importMode={importSettings.mode}
        importDisabled={controller.activeJobs > 0}
        onSearch={controller.setSearchText}
        onImportFiles={() => void importAssets("files")}
        onImportFolder={() => void importAssets("folder")}
        onImportSettings={() => setImportSettingsOpen(true)}
        onSort={controller.setSortBy}
        onViewMode={setViewMode}
        onToggleFilters={() => setFiltersExpanded((value) => !value)}
        onToggleSidebar={() => setSidebarVisible((value) => !value)}
        onLibraryMenu={() => { setAppMenuOpen(false); setLibraryMenuOpen((value) => !value); }}
        onAppMenu={() => { setLibraryMenuOpen(false); setAppMenuOpen((value) => !value); }}
        libraryMenuOpen={libraryMenuOpen}
        appMenuOpen={appMenuOpen}
        libraryMenuTriggerRef={libraryMenuTriggerRef}
        appMenuTriggerRef={appMenuTriggerRef}
      />

      {libraryMenuOpen ? (
        <div ref={libraryMenuRef} className="library-menu" role="menu" aria-label="资源库操作">
          <button type="button" role="menuitem" onClick={() => { setLibraryMenuOpen(false); void createLibrary(); }}><FilePlus2 size={15} />新建资源库<kbd>⌘N</kbd></button>
          <button type="button" role="menuitem" onClick={() => { setLibraryMenuOpen(false); void openLibrary(); }}><FolderOpen size={15} />打开资源库<kbd>⌘O</kbd></button>
          <button type="button" role="menuitem" onClick={() => { setLibraryMenuOpen(false); void saveCopy(); }}><Copy size={15} />另存副本…</button>
          <button type="button" role="menuitem" onClick={() => void inspectIntegrity()}><ShieldCheck size={15} />检查资源库完整性</button>
          <button type="button" role="menuitem" onClick={() => void compactLibrary()} disabled={controller.activeJobs > 0}><Database size={15} />压缩资源库</button>
        </div>
      ) : null}

      {appMenuOpen ? (
        <div ref={appMenuRef} className="library-menu app-menu" role="menu" aria-label="应用操作">
          <button
            type="button"
            role="menuitem"
            aria-pressed={theme === "dark"}
            onClick={() => setTheme((currentTheme) => currentTheme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            {theme === "dark" ? "浅色模式" : "深色模式"}
            <span className={`theme-switch ${theme === "dark" ? "is-on" : ""}`} aria-hidden="true"><span /></span>
          </button>
          <div className="menu-divider" role="separator" />
          <button type="button" role="menuitem" onClick={() => { setAppMenuOpen(false); void updater.checkForUpdates(true); }}><RefreshCw size={15} />检查更新…</button>
          <button type="button" role="menuitem" disabled title="偏好设置将在后续版本开放"><Settings size={15} />偏好设置<kbd>⌘,</kbd></button>
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
            onOpenFolder={openFolder}
            onFolderSecurity={handleFolderSecurity}
            onShareFolder={openLanShare}
            sharedFolderId={lanShareInfo.active ? lanShareInfo.folderId : null}
            discoveredLanShares={discoveredLanShares}
            onOpenLanShare={openDiscoveredLanShare}
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
            onRename={(asset, displayName) => controller.updateAsset(asset.id, { displayName })}
            onAssignAssets={assignAssetsToFolder}
            onDelete={deleteAssets}
            onExternalDragError={(reason) => setToast({ kind: "error", message: `无法拖出资源：${String(reason)}` })}
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

      {folderPassword ? (
        <FolderPasswordDialog
          key={`${folderPassword.mode}:${folderPassword.folder.id}`}
          folder={folderPassword.folder}
          mode={folderPassword.mode}
          onCancel={() => setFolderPassword(null)}
          onSubmit={submitFolderPassword}
        />
      ) : null}

      {lanShareFolderId ? (
        <LanShareDialog
          key={lanShareFolderId}
          folders={controller.folders}
          libraryReadOnly={controller.library.readOnly}
          info={lanShareInfo}
          initialFolderId={lanShareFolderId}
          onClose={() => setLanShareFolderId(null)}
          onStart={startLanShare}
          onStop={stopLanShare}
        />
      ) : null}

      {importSettingsOpen ? (
        <ImportSettingsDialog
          settings={importSettings}
          onCancel={() => setImportSettingsOpen(false)}
          onSave={saveImportSettings}
        />
      ) : null}

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
