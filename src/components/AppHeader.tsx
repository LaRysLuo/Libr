import {
  ChevronDown,
  Filter,
  Grid2X2,
  Import,
  LayoutGrid,
  List,
  Menu,
  Search,
  Settings,
} from "lucide-react";
import type { ChangeEvent } from "react";
import type { LibraryInfo, SearchQuery } from "../types";
import { IconButton } from "./IconButton";

interface AppHeaderProps {
  library: LibraryInfo;
  searchText: string;
  sortBy: SearchQuery["sortBy"];
  viewMode: "grid" | "list";
  onSearch: (value: string) => void;
  onImport: () => void;
  onSort: (value: SearchQuery["sortBy"]) => void;
  onViewMode: (value: "grid" | "list") => void;
  onToggleFilters: () => void;
  onToggleSidebar: () => void;
  onLibraryMenu: () => void;
  onAppMenu: () => void;
}

export function AppHeader({
  library,
  searchText,
  sortBy,
  viewMode,
  onSearch,
  onImport,
  onSort,
  onViewMode,
  onToggleFilters,
  onToggleSidebar,
  onLibraryMenu,
  onAppMenu,
}: AppHeaderProps) {
  const handleSort = (event: ChangeEvent<HTMLSelectElement>) => onSort(event.target.value as SearchQuery["sortBy"]);

  return (
    <header className="app-header" data-tauri-drag-region>
      <div className="header-brand" data-tauri-drag-region>
        <IconButton label="显示或隐藏侧边栏" onClick={onToggleSidebar}><Menu size={18} /></IconButton>
        <strong className="product-title" data-tauri-drag-region>资源库</strong>
        <span className="header-divider" aria-hidden="true" />
        <button type="button" className="library-switcher" onClick={onLibraryMenu}>
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
        <button type="button" className="primary-button import-button" onClick={onImport}>
          <Import size={16} />
          <span>导入</span>
          <span className="button-caret"><ChevronDown size={13} /></span>
        </button>
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
        <IconButton label="应用设置" onClick={onAppMenu}><Settings size={16} /></IconButton>
      </div>
    </header>
  );
}
