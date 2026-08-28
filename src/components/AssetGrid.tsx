import { Check, Heart, ListChecks, Play, Star } from "lucide-react";
import { memo, useCallback } from "react";
import type { Asset } from "../types";
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
}

const formatDuration = (durationMs?: number | null) => {
  if (!durationMs) return null;
  const seconds = Math.floor(durationMs / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
};

const AssetCard = memo(function AssetCard({
  asset,
  selected,
  onSelect,
  onOpen,
  onToggleFavorite,
}: {
  asset: Asset;
  selected: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onOpen: () => void;
  onToggleFavorite: (event: React.MouseEvent) => void;
}) {
  const duration = formatDuration(asset.durationMs);
  return (
    <article
      className={`asset-card ${selected ? "is-selected" : ""}`}
      tabIndex={0}
      aria-selected={selected}
      data-asset-id={asset.id}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
      }}
    >
      <div className="asset-thumbnail">
        <AssetArtwork asset={asset} />
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

export function AssetGrid({ assets, selectedIds, viewMode, thumbnailSize, loading, onSelect, onOpen, onToggleFavorite }: AssetGridProps) {
  const handleSelect = useCallback((assetId: string, event: React.MouseEvent) => {
    onSelect(assetId, event.metaKey || event.ctrlKey, event.shiftKey);
  }, [onSelect]);

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
          />
        ))}
      </div>
    </div>
  );
}
