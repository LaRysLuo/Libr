import {
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Clock3,
  CopyCheck,
  Folder as FolderIcon,
  FolderOpen,
  Heart,
  Inbox,
  Library,
  Plus,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { Folder, NavigationCounts, SmartFolder } from "../types";
import type { NavigationScope } from "../hooks/useLibraryController";
import { ASSET_DRAG_TYPE, readDraggedAssetIds } from "../lib/drag";

interface SidebarProps {
  scope: NavigationScope;
  folders: Folder[];
  smartFolders: SmartFolder[];
  counts: NavigationCounts;
  onScope: (scope: NavigationScope) => void;
  onCreateFolder: (name: string) => Promise<void> | void;
  onCreateSmartFolder: (name: string) => Promise<void> | void;
  onAssignAssets: (assetIds: string[], folderId: string) => Promise<void> | void;
}

interface NavRowProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  selected?: boolean;
  depth?: number;
  disclosure?: "open" | "closed";
  onClick: () => void;
  dropActive?: boolean;
  onDragOver?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLButtonElement>) => void;
}

const NavRow = memo(function NavRow({ icon, label, count, selected, depth = 0, disclosure, onClick, dropActive, onDragOver, onDragLeave, onDrop }: NavRowProps) {
  return (
    <button
      type="button"
      className={`sidebar-row ${selected ? "is-selected" : ""} ${dropActive ? "is-drop-target" : ""}`}
      style={{ paddingInlineStart: `${12 + depth * 16}px` }}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {disclosure === "open" ? <ChevronDown size={13} /> : disclosure === "closed" ? <ChevronRight size={13} /> : <span className="disclosure-space" />}
      <span className="sidebar-icon">{icon}</span>
      <span className="sidebar-label">{label}</span>
      {typeof count === "number" ? <span className="sidebar-count">{count.toLocaleString("zh-CN")}</span> : null}
    </button>
  );
});

function InlineCreate({ placeholder, onCancel, onCreate }: { placeholder: string; onCancel: () => void; onCreate: (name: string) => Promise<void> | void }) {
  const [value, setValue] = useState("");
  return <form className="sidebar-inline-create" onSubmit={(event) => { event.preventDefault(); if (value.trim()) void Promise.resolve(onCreate(value)).then(onCancel); }}><input autoFocus aria-label={placeholder} placeholder={placeholder} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }} /><button type="submit" disabled={!value.trim()}>添加</button></form>;
}

export function Sidebar({ scope, folders, smartFolders, counts, onScope, onCreateFolder, onCreateSmartFolder, onAssignAssets }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState<"folder" | "smart" | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const roots = useMemo(() => folders.filter((folder) => !folder.parentId), [folders]);
  const children = useMemo(() => {
    const map = new Map<string, Folder[]>();
    for (const folder of folders) {
      if (!folder.parentId) continue;
      const current = map.get(folder.parentId) ?? [];
      current.push(folder);
      map.set(folder.parentId, current);
    }
    return map;
  }, [folders]);

  const toggleFolder = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const dropHandlers = (folderId: string) => ({
    dropActive: dropTargetId === folderId,
    onDragOver: (event: React.DragEvent<HTMLButtonElement>) => {
      if (!Array.from(event.dataTransfer.types).includes(ASSET_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDropTargetId(folderId);
    },
    onDragLeave: (event: React.DragEvent<HTMLButtonElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetId(null);
    },
    onDrop: (event: React.DragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const assetIds = readDraggedAssetIds(event.dataTransfer);
      setDropTargetId(null);
      if (assetIds.length) void onAssignAssets(assetIds, folderId);
    },
  });

  return (
    <aside className="sidebar">
      <nav className="sidebar-primary" aria-label="资源库导航">
        <NavRow icon={<Library size={16} />} label="全部资源" count={counts.all} selected={scope === "all"} onClick={() => onScope("all")} />
        <NavRow icon={<Clock3 size={16} />} label="最近添加" count={counts.recent} selected={scope === "recent"} onClick={() => onScope("recent")} />
        <NavRow icon={<Inbox size={16} />} label="未分类" count={counts.unfiled} selected={scope === "unfiled"} onClick={() => onScope("unfiled")} />
        <NavRow icon={<Heart size={16} />} label="收藏" count={counts.favorites} selected={scope === "favorites"} onClick={() => onScope("favorites")} />
        <NavRow icon={<CopyCheck size={16} />} label="重复项" count={counts.duplicates} selected={scope === "duplicates"} onClick={() => onScope("duplicates")} />
      </nav>

      <section className="sidebar-section">
        <div className="sidebar-section-title"><span>文件夹</span><button type="button" aria-label="新建文件夹" onClick={() => setCreating(creating === "folder" ? null : "folder")}><Plus size={15} /></button></div>
        {creating === "folder" ? <InlineCreate placeholder="文件夹名称" onCancel={() => setCreating(null)} onCreate={onCreateFolder} /> : null}
        {roots.map((root) => {
          const nested = children.get(root.id) ?? [];
          const isCollapsed = collapsed.has(root.id);
          return (
            <div key={root.id}>
              <NavRow
                icon={isCollapsed ? <FolderIcon size={16} /> : <FolderOpen size={16} />}
                label={root.name}
                count={root.itemCount}
                selected={scope === `folder:${root.id}`}
                disclosure={nested.length ? (isCollapsed ? "closed" : "open") : undefined}
                onClick={() => nested.length ? toggleFolder(root.id) : onScope(`folder:${root.id}`)}
                {...dropHandlers(root.id)}
              />
              {!isCollapsed ? nested.map((folder) => (
                <NavRow
                  key={folder.id}
                  icon={<FolderIcon size={15} />}
                  label={folder.name}
                  count={folder.itemCount}
                  depth={1}
                  selected={scope === `folder:${folder.id}`}
                  onClick={() => onScope(`folder:${folder.id}`)}
                  {...dropHandlers(folder.id)}
                />
              )) : null}
            </div>
          );
        })}
      </section>

      <section className="sidebar-section smart-section">
        <div className="sidebar-section-title"><span>智能文件夹</span><button type="button" aria-label="新建智能文件夹" onClick={() => setCreating(creating === "smart" ? null : "smart")}><Plus size={15} /></button></div>
        {creating === "smart" ? <InlineCreate placeholder="智能文件夹名称" onCancel={() => setCreating(null)} onCreate={onCreateSmartFolder} /> : null}
        {smartFolders.map((folder, index) => (
          <NavRow
            key={folder.id}
            icon={index < 2 ? <CirclePlus size={15} /> : index === 2 ? <Sparkles size={15} /> : <Tag size={15} />}
            label={folder.name}
            count={folder.itemCount}
            selected={scope === `smart:${folder.id}`}
            onClick={() => onScope(`smart:${folder.id}`)}
          />
        ))}
      </section>

      <div className="sidebar-spacer" />
      <nav className="sidebar-bottom">
        <NavRow icon={<Trash2 size={16} />} label="回收站" count={counts.trash} selected={scope === "trash"} onClick={() => onScope("trash")} />
      </nav>
    </aside>
  );
}
