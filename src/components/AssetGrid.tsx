import { Check, ListChecks, Pause, Play, Star } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { Asset } from "../types";
import { ASSET_DRAG_TYPE } from "../lib/drag";
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
  onAssignAssets: (assetIds: string[], folderId: string) => Promise<void> | void;
}

const formatDuration = (durationMs?: number | null) => {
  if (!durationMs) return null;
  const seconds = Math.floor(durationMs / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
};

const AUDIO_PREVIEW_EVENT = "libr:audio-preview-play";

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
        preload="metadata"
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
}

const AssetCard = memo(function AssetCard({
  asset,
  selected,
  onSelect,
  onOpen,
  onToggleFavorite,
  onDragStart,
  onDragEnd,
  onPointerDown,
}: {
  asset: Asset;
  selected: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onOpen: () => void;
  onToggleFavorite: (event: React.MouseEvent) => void;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: (event: React.DragEvent<HTMLElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
}) {
  const duration = formatDuration(asset.durationMs);
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
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
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
        <span className="asset-name" title={asset.displayName}>{asset.displayName}</span>
        <span className="asset-extension">{asset.extension}</span>
      </div>
    </article>
  );
});

export function AssetGrid({ assets, selectedIds, viewMode, thumbnailSize, loading, onSelect, onOpen, onToggleFavorite, onAssignAssets }: AssetGridProps) {
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const suppressClickRef = useRef(false);
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
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, audio")) return;
    const assetIds = selectedIds.has(assetId) ? [...selectedIds] : [assetId];
    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      assetId,
      assetIds,
      source: event.currentTarget,
      preview: null,
      dropTarget: null,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [selectedIds]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const state = pointerDragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (!state.preview && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 6) return;
    event.preventDefault();
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
  }, [onSelect, selectedIds]);

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
            onDragStart={(event) => handleDragStart(asset.id, event)}
            onDragEnd={handleDragEnd}
            onPointerDown={(event) => handlePointerDown(asset.id, event)}
          />
        ))}
      </div>
    </div>
  );
}
