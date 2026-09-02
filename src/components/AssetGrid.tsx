import { Check, ListChecks, Pause, Play, Star, Trash2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Asset } from "../types";
import {
  ASSET_DRAG_TYPE,
  folderIdAtScreenPosition,
  prepareNativeAssetDrag,
  startNativeAssetDrag,
} from "../lib/drag";
import { isTauriRuntime } from "../lib/tauri";
import { useDismissibleLayer } from "../hooks/useDismissibleLayer";
import { AssetArtwork } from "./AssetArtwork";

interface AssetGridProps {
  assets: Asset[];
  selectedIds: Set<string>;
  viewMode: "grid" | "list";
  thumbnailSize: number;
  loading: boolean;
  onSelect: (id: string, additive?: boolean, range?: boolean) => void;
  onOpen: (asset: Asset) => void;
  onToggleFavorite: (asset: Asset) => void;
  onRename: (asset: Asset, displayName: string) => Promise<void> | void;
  onAssignAssets: (assetIds: string[], folderId: string) => Promise<void> | void;
  onDelete: (assets: Asset[]) => void;
  onExternalDragError?: (reason: unknown) => void;
}

const formatDuration = (durationMs?: number | null) => {
  if (!durationMs) return null;
  const seconds = Math.floor(durationMs / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
};

const AUDIO_PREVIEW_EVENT = "libr:audio-preview-play";
const EMPTY_ASSETS: Asset[] = [];

function AudioPreviewControl({ asset }: { asset: Asset }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const pauseOtherPreview = (event: Event) => {
      if ((event as CustomEvent<string>).detail === asset.id) return;
      audioRef.current?.pause();
    };
    window.addEventListener(AUDIO_PREVIEW_EVENT, pauseOtherPreview);
    return () => window.removeEventListener(AUDIO_PREVIEW_EVENT, pauseOtherPreview);
  }, [asset.id]);

  const togglePlayback = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
      window.dispatchEvent(new CustomEvent(AUDIO_PREVIEW_EVENT, { detail: asset.id }));
    } catch {
      setPlaying(false);
    }
  }, [asset.id, playing]);

  if (!asset.assetUrl) return null;
  return (
    <>
      <audio
        ref={audioRef}
        src={asset.assetUrl}
        preload="none"
        aria-label={`${asset.displayName} 音频`}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        className="media-play"
        aria-label={`${playing ? "暂停" : "播放"} ${asset.displayName}`}
        title={playing ? "暂停" : "播放"}
        onClick={(event) => void togglePlayback(event)}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
      </button>
    </>
  );
}

const createCompactDragPreview = (source: HTMLElement, count: number) => {
  const thumbnail = source.querySelector<HTMLElement>(".asset-thumbnail");
  if (!thumbnail) return;
  const preview = document.createElement("div");
  preview.className = "asset-drag-preview";
  const clonedThumbnail = thumbnail.cloneNode(true) as HTMLElement;
  clonedThumbnail.className = "asset-drag-preview-thumbnail";
  preview.appendChild(clonedThumbnail);
  if (count > 1) {
    const badge = document.createElement("span");
    badge.textContent = String(count);
    preview.appendChild(badge);
  }
  document.body.appendChild(preview);
  return preview;
};

const setCompactDragImage = (event: React.DragEvent<HTMLElement>, count: number) => {
  if (typeof event.dataTransfer.setDragImage !== "function") return;
  const preview = createCompactDragPreview(event.currentTarget, count);
  if (!preview) return;
  event.dataTransfer.setDragImage(preview, 34, 34);
  window.requestAnimationFrame(() => preview.remove());
};

interface PointerDragState {
  pointerId: number;
  startX: number;
  startY: number;
  assetId: string;
  assetIds: string[];
  source: HTMLElement;
  preview: HTMLElement | null;
  dropTarget: HTMLElement | null;
  nativeDrag: boolean;
  nativeDragStarted: boolean;
  preparation: ReturnType<typeof prepareNativeAssetDrag> | null;
}

const AssetCard = memo(function AssetCard({
  asset,
  selected,
  onSelect,
  onOpen,
  onToggleFavorite,
  onRename,
  onDragStart,
  onDragEnd,
  onPointerDown,
  onContextMenu,
}: {
  asset: Asset;
  selected: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onOpen: () => void;
  onToggleFavorite: (event: React.MouseEvent) => void;
  onRename: (displayName: string) => Promise<void> | void;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: (event: React.DragEvent<HTMLElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => void;
}) {
  const duration = formatDuration(asset.durationMs);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(asset.displayName);

  const startRenaming = useCallback(() => {
    setNameDraft(asset.displayName);
    setRenaming(true);
  }, [asset.displayName]);

  const finishRenaming = useCallback(() => {
    const nextName = nameDraft.trim();
    setRenaming(false);
    if (!nextName || nextName === asset.displayName) {
      setNameDraft(asset.displayName);
      return;
    }
    void onRename(nextName);
  }, [asset.displayName, nameDraft, onRename]);

  const cancelRenaming = useCallback(() => {
    setNameDraft(asset.displayName);
    setRenaming(false);
  }, [asset.displayName]);

  useEffect(() => {
    if (!renaming) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    const extensionSeparator = asset.displayName.lastIndexOf(".");
    input.setSelectionRange(0, extensionSeparator > 0 ? extensionSeparator : asset.displayName.length);
  }, [asset.displayName, renaming]);

  return (
    <article
      className={`asset-card ${selected ? "is-selected" : ""}`}
      tabIndex={0}
      aria-selected={selected}
      data-asset-id={asset.id}
      draggable={false}
      onClick={onSelect}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "F2") {
          event.preventDefault();
          startRenaming();
          return;
        }
        if (event.key === "Enter") onOpen();
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          onContextMenu(event);
        }
      }}
    >
      <div className="asset-thumbnail">
        <AssetArtwork asset={asset} />
        {asset.kind === "audio" ? <AudioPreviewControl asset={asset} /> : null}
        {selected ? <span className="selection-check"><Check size={13} strokeWidth={3} /></span> : null}
        {asset.favorite ? <button type="button" className="favorite-badge is-active" aria-label="取消收藏" onClick={onToggleFavorite}><Star size={14} fill="currentColor" /></button> : null}
        {duration ? <span className="duration-badge">{asset.kind === "video" ? <Play size={10} fill="currentColor" /> : null}{duration}</span> : null}
      </div>
      <div className="asset-caption">
        {renaming ? (
          <input
            ref={renameInputRef}
            className="asset-name-input"
            value={nameDraft}
            aria-label={`重命名 ${asset.displayName}`}
            spellCheck={false}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={finishRenaming}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                finishRenaming();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelRenaming();
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="asset-name"
            title={`${asset.displayName}（点击重命名）`}
            aria-label={`重命名 ${asset.displayName}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(event);
              startRenaming();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {asset.displayName}
          </button>
        )}
        <span className="asset-extension">{asset.extension}</span>
      </div>
    </article>
  );
});

interface AssetContextMenuState {
  assetIds: string[];
  x: number;
  y: number;
}

export function AssetGrid({ assets, selectedIds, viewMode, thumbnailSize, loading, onSelect, onOpen, onToggleFavorite, onRename, onAssignAssets, onDelete, onExternalDragError }: AssetGridProps) {
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const suppressClickRef = useRef(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [contextMenu, setContextMenu] = useState<AssetContextMenuState | null>(null);
  const handleSelect = useCallback((assetId: string, event: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelect(assetId, event.metaKey || event.ctrlKey, event.shiftKey);
  }, [onSelect]);

  const handleDragStart = useCallback((assetId: string, event: React.DragEvent<HTMLElement>) => {
    const draggedIds = selectedIds.has(assetId) ? [...selectedIds] : [assetId];
    if (!selectedIds.has(assetId)) onSelect(assetId);
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(draggedIds));
    event.dataTransfer.setData("text/plain", `libr-assets:${JSON.stringify(draggedIds)}`);
    event.currentTarget.classList.add("is-dragging");
    document.documentElement.classList.add("is-asset-dragging");
    setCompactDragImage(event, draggedIds.length);
  }, [onSelect, selectedIds]);

  const handleDragEnd = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.currentTarget.classList.remove("is-dragging");
    document.documentElement.classList.remove("is-asset-dragging");
  }, []);

  const cleanupPointerDrag = useCallback((assign: boolean) => {
    const state = pointerDragRef.current;
    if (!state) return;
    const folderId = state.dropTarget?.dataset.folderDropTarget;
    state.preview?.remove();
    state.dropTarget?.classList.remove("is-drop-target");
    state.source.classList.remove("is-dragging");
    if (state.source.hasPointerCapture?.(state.pointerId)) state.source.releasePointerCapture(state.pointerId);
    document.documentElement.classList.remove("is-asset-dragging");
    pointerDragRef.current = null;
    if (assign && folderId) void onAssignAssets(state.assetIds, folderId);
  }, [onAssignAssets]);

  const handlePointerDown = useCallback((assetId: string, event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, audio")) return;
    const assetIds = selectedIds.has(assetId) ? [...selectedIds] : [assetId];
    const nativeDrag = isTauriRuntime();
    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      assetId,
      assetIds,
      source: event.currentTarget,
      preview: null,
      dropTarget: null,
      nativeDrag,
      nativeDragStarted: false,
      preparation: nativeDrag ? prepareNativeAssetDrag(assetIds) : null,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [selectedIds]);

  const beginNativeDrag = useCallback(async (state: PointerDragState) => {
    try {
      state.source.classList.add("is-preparing-drag");
      const prepared = await state.preparation;
      if (!prepared || pointerDragRef.current !== state) {
        state.source.classList.remove("is-preparing-drag");
        return;
      }

      suppressClickRef.current = true;
      cleanupPointerDrag(false);
      state.source.classList.remove("is-preparing-drag");
      state.source.classList.add("is-dragging");
      document.documentElement.classList.add("is-asset-dragging");

      await startNativeAssetDrag(
        prepared,
        (position) => {
          void folderIdAtScreenPosition(position).then((folderId) => {
            if (folderId) void onAssignAssets(state.assetIds, folderId);
          });
        },
        () => {
          state.source.classList.remove("is-dragging", "is-preparing-drag");
          document.documentElement.classList.remove("is-asset-dragging");
        },
      );
    } catch (reason) {
      state.source.classList.remove("is-dragging", "is-preparing-drag");
      document.documentElement.classList.remove("is-asset-dragging");
      if (pointerDragRef.current === state) cleanupPointerDrag(false);
      onExternalDragError?.(reason);
    }
  }, [cleanupPointerDrag, onAssignAssets, onExternalDragError]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const state = pointerDragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (!state.preview && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 6) return;
    event.preventDefault();
    if (state.nativeDrag) {
      if (!state.nativeDragStarted) {
        state.nativeDragStarted = true;
        if (!selectedIds.has(state.assetId)) onSelect(state.assetId);
        void beginNativeDrag(state);
      }
      return;
    }
    if (!state.preview) {
      if (!selectedIds.has(state.assetId)) onSelect(state.assetId);
      state.preview = createCompactDragPreview(state.source, state.assetIds.length) ?? null;
      state.source.classList.add("is-dragging");
      document.documentElement.classList.add("is-asset-dragging");
    }
    if (state.preview) {
      state.preview.style.left = `${event.clientX + 12}px`;
      state.preview.style.top = `${event.clientY + 12}px`;
    }
    const nextTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-folder-drop-target]") ?? null;
    if (nextTarget !== state.dropTarget) {
      state.dropTarget?.classList.remove("is-drop-target");
      nextTarget?.classList.add("is-drop-target");
      state.dropTarget = nextTarget;
    }
  }, [beginNativeDrag, onSelect, selectedIds]);

  const handlePointerUp = useCallback((event: PointerEvent) => {
    const state = pointerDragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (state.preview) suppressClickRef.current = true;
    cleanupPointerDrag(Boolean(state.preview));
  }, [cleanupPointerDrag]);

  const handlePointerCancel = useCallback((event: PointerEvent) => {
    if (pointerDragRef.current?.pointerId !== event.pointerId) return;
    cleanupPointerDrag(false);
  }, [cleanupPointerDrag]);

  const openContextMenu = useCallback((assetId: string, event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    event.preventDefault();
    const assetIds = selectedIds.has(assetId) ? [...selectedIds] : [assetId];
    if (!selectedIds.has(assetId)) onSelect(assetId);
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseEvent = "clientX" in event ? event : null;
    setContextMenu({
      assetIds,
      x: mouseEvent?.clientX || rect.left + 16,
      y: mouseEvent?.clientY || rect.top + 16,
    });
  }, [onSelect, selectedIds]);

  const contextAssets = useMemo(() => {
    if (!contextMenu) return EMPTY_ASSETS;
    const contextAssetIds = new Set(contextMenu.assetIds);
    return assets.filter((asset) => contextAssetIds.has(asset.id));
  }, [assets, contextMenu]);
  const permanentlyDelete = contextAssets.length > 0 && contextAssets.every((asset) => Boolean(asset.deletedAt));

  const deleteFromContextMenu = useCallback(() => {
    if (!contextAssets.length) return;
    onDelete(contextAssets);
    setContextMenu(null);
  }, [contextAssets, onDelete]);

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [handlePointerCancel, handlePointerMove, handlePointerUp]);

  useEffect(() => () => cleanupPointerDrag(false), [cleanupPointerDrag]);

  useEffect(() => {
    if (!contextMenu) return;
    contextMenuButtonRef.current?.focus();
  }, [contextMenu]);

  useDismissibleLayer({
    open: Boolean(contextMenu),
    layerRef: contextMenuRef,
    onDismiss: () => setContextMenu(null),
    closeOnScroll: true,
  });

  if (!loading && assets.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon"><ListChecks size={30} /></span>
        <h2>这里还没有资源</h2>
        <p>拖入文件或使用右上角的“导入”开始整理。</p>
      </div>
    );
  }

  return (
    <div className={`asset-scroller ${loading ? "is-loading" : ""}`}>
      <div
        className={`asset-grid ${viewMode === "list" ? "is-list" : ""}`}
        style={viewMode === "grid" ? { gridTemplateColumns: `repeat(auto-fill, minmax(${thumbnailSize}px, 1fr))` } : undefined}
        role="listbox"
        aria-label="资源列表"
        aria-multiselectable="true"
      >
        {assets.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            selected={selectedIds.has(asset.id)}
            onSelect={(event) => handleSelect(asset.id, event)}
            onOpen={() => onOpen(asset)}
            onToggleFavorite={(event) => { event.stopPropagation(); onToggleFavorite(asset); }}
            onRename={(displayName) => onRename(asset, displayName)}
            onDragStart={(event) => handleDragStart(asset.id, event)}
            onDragEnd={handleDragEnd}
            onPointerDown={(event) => handlePointerDown(asset.id, event)}
            onContextMenu={(event) => openContextMenu(asset.id, event)}
          />
        ))}
      </div>
      {contextMenu && contextAssets.length > 0 ? (
        <div
          ref={contextMenuRef}
          className="asset-context-menu"
          role="menu"
          aria-label="资源操作"
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 224)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 58)),
          }}
        >
          <button
            ref={contextMenuButtonRef}
            type="button"
            role="menuitem"
            className="asset-context-menu-item is-danger"
            onClick={deleteFromContextMenu}
          >
            <Trash2 size={15} />
            {permanentlyDelete
              ? contextAssets.length === 1 ? "永久删除" : `永久删除 ${contextAssets.length} 项`
              : contextAssets.length === 1 ? "移到回收站" : `将 ${contextAssets.length} 项移到回收站`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
