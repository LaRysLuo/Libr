import {
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Clock3,
  CopyCheck,
  ExternalLink,
  Folder as FolderIcon,
  FolderOpen,
  Heart,
  Inbox,
  Library,
  Globe2,
  LockKeyhole,
  LockKeyholeOpen,
  MoreHorizontal,
  Plus,
  RadioTower,
  ShieldOff,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import type { DiscoveredLanShare, Folder, NavigationCounts, SmartFolder } from "../types";
import type { NavigationScope } from "../hooks/useLibraryController";
import { useDismissibleLayer } from "../hooks/useDismissibleLayer";
import { hasDraggedAssets, readDraggedAssetIds } from "../lib/drag";

interface SidebarProps {
  scope: NavigationScope;
  folders: Folder[];
  smartFolders: SmartFolder[];
  counts: NavigationCounts;
  onScope: (scope: NavigationScope) => void;
  onOpenFolder: (folder: Folder) => void;
  onFolderSecurity: (folder: Folder, action: "encrypt" | "unlock" | "lock" | "remove") => void;
  onShareFolder: (folder: Folder) => void;
  sharedFolderId?: string | null;
  discoveredLanShares: DiscoveredLanShare[];
  onOpenLanShare: (share: DiscoveredLanShare) => void;
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
  dropFolderId?: string;
  onDragOver?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLButtonElement>) => void;
  folderSecurity?: "locked" | "unlocked";
  onMore?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  moreLabel?: string;
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

const NavRow = memo(function NavRow({ icon, label, count, selected, depth = 0, disclosure, onClick, dropActive, dropFolderId, onDragOver, onDragLeave, onDrop, folderSecurity, onMore, moreLabel, onContextMenu }: NavRowProps) {
  return (
    <div className={`sidebar-row-shell ${onMore ? "has-more" : ""}`}>
      <button
        type="button"
        className={`sidebar-row ${selected ? "is-selected" : ""} ${dropActive ? "is-drop-target" : ""}`}
        data-folder-drop-target={dropFolderId}
        style={{ paddingInlineStart: `${12 + depth * 16}px` }}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {disclosure === "open" ? <ChevronDown size={13} /> : disclosure === "closed" ? <ChevronRight size={13} /> : <span className="disclosure-space" />}
        <span className="sidebar-icon">{icon}</span>
        <span className="sidebar-label">{label}</span>
        {dropActive
          ? <span className="sidebar-drop-hint">松开添加</span>
          : <>{folderSecurity === "locked" ? <LockKeyhole className="folder-lock-indicator" size={13} aria-label="已锁定" /> : folderSecurity === "unlocked" ? <LockKeyholeOpen className="folder-lock-indicator" size={13} aria-label="已解锁" /> : null}{typeof count === "number" ? <span className="sidebar-count">{count.toLocaleString("zh-CN")}</span> : null}</>}
      </button>
      {onMore ? <button type="button" className="sidebar-row-more" aria-label={moreLabel} onClick={onMore}><MoreHorizontal size={14} /></button> : null}
    </div>
  );
});

function InlineCreate({ placeholder, onCancel, onCreate }: { placeholder: string; onCancel: () => void; onCreate: (name: string) => Promise<void> | void }) {
  const [value, setValue] = useState("");
  return <form className="sidebar-inline-create" onSubmit={(event) => { event.preventDefault(); if (value.trim()) void Promise.resolve(onCreate(value)).then(onCancel); }}><input autoFocus aria-label={placeholder} placeholder={placeholder} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }} /><button type="submit" disabled={!value.trim()}>添加</button></form>;
}

export function Sidebar({ scope, folders, smartFolders, counts, onScope, onOpenFolder, onFolderSecurity, onShareFolder, sharedFolderId, discoveredLanShares, onOpenLanShare, onCreateFolder, onCreateSmartFolder, onAssignAssets }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState<"folder" | "smart" | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ folderId: string; x: number; y: number } | null>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);
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

  const dropHandlers = (folder: Folder) => ({
    dropFolderId: folder.isLocked ? undefined : folder.id,
    dropActive: !folder.isLocked && dropTargetId === folder.id,
    onDragOver: (event: React.DragEvent<HTMLButtonElement>) => {
      if (folder.isLocked) return;
      if (!hasDraggedAssets(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDropTargetId(folder.id);
    },
    onDragLeave: (event: React.DragEvent<HTMLButtonElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetId(null);
    },
    onDrop: (event: React.DragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const assetIds = readDraggedAssetIds(event.dataTransfer);
      setDropTargetId(null);
      document.documentElement.classList.remove("is-asset-dragging");
      if (assetIds.length) void onAssignAssets(assetIds, folder.id);
    },
  });

  const showFolderMenu = (event: React.MouseEvent, folderId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setFolderMenu({ folderId, x: event.clientX || rect.right, y: event.clientY || rect.bottom });
  };

  useDismissibleLayer({
    open: Boolean(folderMenu),
    layerRef: folderMenuRef,
    onDismiss: () => setFolderMenu(null),
    closeOnScroll: true,
  });

  const activeMenuFolder = folderMenu ? folders.find((folder) => folder.id === folderMenu.folderId) : undefined;
  const lockOwner = activeMenuFolder?.lockOwnerId ? folders.find((folder) => folder.id === activeMenuFolder.lockOwnerId) : activeMenuFolder;
  const folderRowActions = (folder: Folder) => ({
    folderSecurity: folder.isLocked ? "locked" as const : folder.isEncrypted ? "unlocked" as const : undefined,
    moreLabel: `文件夹操作 ${folder.name}`,
    onMore: (event: React.MouseEvent<HTMLButtonElement>) => showFolderMenu(event, folder.id),
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => showFolderMenu(event, folder.id),
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
                onClick={() => root.isLocked ? onOpenFolder(root) : nested.length ? toggleFolder(root.id) : onOpenFolder(root)}
                {...dropHandlers(root)}
                {...folderRowActions(root)}
              />
              {!isCollapsed ? nested.map((folder) => (
                <NavRow
                  key={folder.id}
                  icon={<FolderIcon size={15} />}
                  label={folder.name}
                  count={folder.itemCount}
                  depth={1}
                  selected={scope === `folder:${folder.id}`}
                  onClick={() => onOpenFolder(folder)}
                  {...dropHandlers(folder)}
                  {...folderRowActions(folder)}
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

      <section className="sidebar-section lan-discovery-section" aria-label="局域网分享">
        <div className="sidebar-section-title">
          <span>局域网分享</span>
          <span className="lan-discovery-status" aria-label={`发现 ${discoveredLanShares.length} 个局域网分享`}>
            <i />{discoveredLanShares.length}
          </span>
        </div>
        {discoveredLanShares.length ? (
          <div className="lan-share-list">
            {discoveredLanShares.map((share) => (
              <button
                key={share.id}
                type="button"
                className="lan-share-row"
                aria-label={`打开 ${share.deviceName} 分享的 ${share.folderName}`}
                title={share.url}
                onClick={() => onOpenLanShare(share)}
              >
                <span className="lan-share-icon"><RadioTower size={15} /></span>
                <span className="lan-share-copy">
                  <strong>{share.folderName}</strong>
                  <small>{share.deviceName} · {share.permission === "manage" ? "可管理" : "仅查看"}</small>
                </span>
                <ExternalLink className="lan-share-open-icon" size={13} />
              </button>
            ))}
          </div>
        ) : (
          <div className="lan-share-empty">
            <RadioTower size={15} />
            <span>正在查找同一网络中的分享…</span>
          </div>
        )}
      </section>

      <div className="sidebar-spacer" />
      <nav className="sidebar-bottom">
        <NavRow icon={<Trash2 size={16} />} label="回收站" count={counts.trash} selected={scope === "trash"} onClick={() => onScope("trash")} />
      </nav>
      {folderMenu && activeMenuFolder ? (
        <div
          ref={folderMenuRef}
          className="folder-context-menu"
          role="menu"
          aria-label={`文件夹操作 ${activeMenuFolder.name}`}
          style={{ left: Math.max(8, Math.min(folderMenu.x, window.innerWidth - 190)), top: Math.max(8, Math.min(folderMenu.y, window.innerHeight - 180)) }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={(activeMenuFolder.isLocked || activeMenuFolder.isEncrypted) && sharedFolderId !== activeMenuFolder.id}
            title={activeMenuFolder.isLocked || activeMenuFolder.isEncrypted ? "加密文件夹不能通过局域网共享" : undefined}
            onClick={() => { setFolderMenu(null); onShareFolder(activeMenuFolder); }}
          >
            <Globe2 size={14} />{sharedFolderId === activeMenuFolder.id ? "管理局域网共享" : "局域网共享"}
            {sharedFolderId === activeMenuFolder.id ? <span className="menu-live-dot" aria-label="正在共享" /> : null}
          </button>
          <div className="menu-divider" role="separator" />
          {activeMenuFolder.isLocked && lockOwner ? (
            <button type="button" role="menuitem" onClick={() => { setFolderMenu(null); onFolderSecurity(lockOwner, "unlock"); }}><LockKeyholeOpen size={14} />解锁{lockOwner.id === activeMenuFolder.id ? "文件夹" : `“${lockOwner.name}”`}</button>
          ) : activeMenuFolder.isEncrypted ? (
            <>
              <button type="button" role="menuitem" onClick={() => { setFolderMenu(null); onFolderSecurity(activeMenuFolder, "lock"); }}><LockKeyhole size={14} />立即锁定</button>
              <button type="button" role="menuitem" onClick={() => { setFolderMenu(null); onFolderSecurity(activeMenuFolder, "remove"); }}><ShieldOff size={14} />取消加密</button>
            </>
          ) : (
            <button type="button" role="menuitem" onClick={() => { setFolderMenu(null); onFolderSecurity(activeMenuFolder, "encrypt"); }}><LockKeyhole size={14} />加密</button>
          )}
        </div>
      ) : null}
    </aside>
  );
}
