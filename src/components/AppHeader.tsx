import {
  ChevronDown,
  FilePlus2,
  Filter,
  FolderOpen,
  Grid2X2,
  Import,
  LayoutGrid,
  List,
  Menu,
  Search,
  Settings,
  Settings2,
  Scissors,
} from "lucide-react";
import { useRef, useState, type ChangeEvent, type RefObject } from "react";
import { useDismissibleLayer } from "../hooks/useDismissibleLayer";
import type { LibraryInfo, SearchQuery } from "../types";
import { IconButton } from "./IconButton";

interface AppHeaderProps {
  library: LibraryInfo;
  searchText: string;
  sortBy: SearchQuery["sortBy"];
  viewMode: "grid" | "list";
  deleteOriginals: boolean;
  onSearch: (value: string) => void;
  onImportFiles: () => void;
  onImportFolder: () => void;
  onImportSettings: () => void;
  onSort: (value: SearchQuery["sortBy"]) => void;
  onViewMode: (value: "grid" | "list") => void;
  onToggleFilters: () => void;
  onToggleSidebar: () => void;
  onLibraryMenu: () => void;
  onAppMenu: () => void;
  libraryMenuOpen: boolean;
  appMenuOpen: boolean;
  libraryMenuTriggerRef: RefObject<HTMLButtonElement | null>;
  appMenuTriggerRef: RefObject<HTMLButtonElement | null>;
}

export function AppHeader({
  library,
  searchText,
  sortBy,
  viewMode,
  deleteOriginals,
  onSearch,
  onImportFiles,
  onImportFolder,
  onImportSettings,
  onSort,
  onViewMode,
  onToggleFilters,
  onToggleSidebar,
  onLibraryMenu,
  onAppMenu,
  libraryMenuOpen,
  appMenuOpen,
  libraryMenuTriggerRef,
  appMenuTriggerRef,
}: AppHeaderProps) {
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const importControlRef = useRef<HTMLDivElement>(null);
  const handleSort = (event: ChangeEvent<HTMLSelectElement>) => onSort(event.target.value as SearchQuery["sortBy"]);

  useDismissibleLayer({
    open: importMenuOpen,
    layerRef: importControlRef,
    onDismiss: () => setImportMenuOpen(false),
  });

  const chooseImport = (action: () => void) => {
    setImportMenuOpen(false);
    action();
  };

  return (
    <header className="app-header" data-tauri-drag-region>
      <div className="header-brand" data-tauri-drag-region>
        <IconButton label="显示或隐藏侧边栏" onClick={onToggleSidebar}><Menu size={18} /></IconButton>
        <strong className="product-title" data-tauri-drag-region>资源库</strong>
        <span className="header-divider" aria-hidden="true" />
        <button
          ref={libraryMenuTriggerRef}
          type="button"
          className="library-switcher"
          aria-haspopup="menu"
          aria-expanded={libraryMenuOpen}
          onClick={onLibraryMenu}
        >
          <span>{library.name}.libr</span>
          <ChevronDown size={14} />
        </button>
      </div>

      <label className="global-search">
        <Search size={16} aria-hidden="true" />
        <input
          value={searchText}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="搜索资源库…"
          aria-label="搜索资源库"
        />
        <kbd>⌘ F</kbd>
      </label>

      <div className="header-actions">
        <div className="import-control" ref={importControlRef}>
          <button type="button" className="primary-button import-button" aria-label={deleteOriginals ? "剪切导入文件" : "导入文件"} onClick={() => chooseImport(onImportFiles)}>
            {deleteOriginals ? <Scissors size={16} /> : <Import size={16} />}
            <span>{deleteOriginals ? "剪切导入" : "导入"}</span>
          </button>
          <button
            type="button"
            className="primary-button import-menu-trigger"
            aria-label="显示导入选项"
            aria-haspopup="menu"
            aria-expanded={importMenuOpen}
            onClick={() => setImportMenuOpen((open) => !open)}
          >
            <ChevronDown size={13} />
          </button>
          {importMenuOpen ? (
            <div className="library-menu import-menu" role="menu" aria-label="导入选项">
              <button type="button" role="menuitem" onClick={() => chooseImport(onImportFiles)}>
                <FilePlus2 size={16} />
                <span>导入文件…</span>
              </button>
              <button type="button" role="menuitem" onClick={() => chooseImport(onImportFolder)}>
                <FolderOpen size={16} />
                <span className="import-menu-copy"><strong>导入文件夹…</strong><small>包含所有子文件夹中的文件</small></span>
              </button>
              <div className="menu-divider" role="separator" />
              <button type="button" role="menuitem" onClick={() => chooseImport(onImportSettings)}>
                <Settings2 size={16} />
                <span className="import-menu-copy"><strong>导入配置…</strong><small>{deleteOriginals ? "当前：导入后删除原文件" : "当前：保留原文件"}</small></span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="segmented-control" aria-label="视图模式">
          <IconButton label="舒适网格" selected={viewMode === "grid"} onClick={() => onViewMode("grid")}><LayoutGrid size={16} /></IconButton>
          <IconButton label="紧凑网格" disabled><Grid2X2 size={16} /></IconButton>
          <IconButton label="列表视图" selected={viewMode === "list"} onClick={() => onViewMode("list")}><List size={16} /></IconButton>
        </div>
        <label className="sort-select">
          <span className="sr-only">排序方式</span>
          <select value={sortBy} onChange={handleSort}>
            <option value="importedAt">按导入时间</option>
            <option value="createdAt">按创建时间</option>
            <option value="name">按名称</option>
            <option value="size">按大小</option>
            <option value="rating">按评分</option>
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
        <IconButton label="显示筛选器" onClick={onToggleFilters}><Filter size={16} /></IconButton>
        <IconButton
          ref={appMenuTriggerRef}
          label="应用设置"
          aria-haspopup="menu"
          aria-expanded={appMenuOpen}
          onClick={onAppMenu}
        ><Settings size={16} /></IconButton>
      </div>
    </header>
  );
}
