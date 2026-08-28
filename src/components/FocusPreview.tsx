import { ChevronLeft, ChevronRight, Info, Maximize2, RotateCw, Star, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState } from "react";
import type { Asset } from "../types";
import { AssetArtwork } from "./AssetArtwork";
import { IconButton } from "./IconButton";

interface FocusPreviewProps {
  asset: Asset;
  assets: Asset[];
  onClose: () => void;
  onNavigate: (asset: Asset) => void;
  onFavorite: (asset: Asset) => void;
}

function FocusMedia({ asset }: { asset: Asset }) {
  if (asset.kind === "video" && asset.assetUrl) {
    return <video className="focus-player" src={asset.assetUrl} poster={asset.previewUrl ?? undefined} controls autoPlay />;
  }
  if (asset.kind === "audio" && asset.assetUrl) {
    return <div className="focus-audio"><AssetArtwork asset={asset} large /><audio src={asset.assetUrl} controls autoPlay /></div>;
  }
  if ((asset.kind === "pdf" || asset.kind === "document") && asset.assetUrl && /^(PDF|TXT|MD|MARKDOWN|JSON|CSV|JS|TS|CSS|HTML|XML|YAML|YML|RS|PY)$/i.test(asset.extension)) {
    return <iframe className="focus-document" src={asset.assetUrl} title={asset.displayName} />;
  }
  return <AssetArtwork asset={asset} large />;
}

export function FocusPreview({ asset, assets, onClose, onNavigate, onFavorite }: FocusPreviewProps) {
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [infoVisible, setInfoVisible] = useState(false);
  const currentIndex = assets.findIndex((item) => item.id === asset.id);
  const navigate = (direction: -1 | 1) => {
    const nextIndex = Math.min(assets.length - 1, Math.max(0, currentIndex + direction));
    const next = assets[nextIndex];
    if (next) onNavigate(next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") navigate(-1);
      if (event.key === "ArrowRight") navigate(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="focus-preview" role="dialog" aria-modal="true" aria-label={`预览 ${asset.displayName}`}>
      <header className="focus-toolbar">
        <div className="focus-group">
          <IconButton label="关闭预览" onClick={onClose}><X size={18} /></IconButton>
          <span className="focus-title">{asset.displayName}</span>
        </div>
        <div className="focus-group focus-center-controls">
          <IconButton label="上一项" disabled={currentIndex <= 0} onClick={() => navigate(-1)}><ChevronLeft size={18} /></IconButton>
          <span>{currentIndex + 1} / {assets.length}</span>
          <IconButton label="下一项" disabled={currentIndex >= assets.length - 1} onClick={() => navigate(1)}><ChevronRight size={18} /></IconButton>
        </div>
        <div className="focus-group">
          <IconButton label="缩小" onClick={() => setZoom((value) => Math.max(25, value - 25))}><ZoomOut size={17} /></IconButton>
          <span className="zoom-value">{zoom}%</span>
          <IconButton label="放大" onClick={() => setZoom((value) => Math.min(400, value + 25))}><ZoomIn size={17} /></IconButton>
          <IconButton label="适合窗口" onClick={() => setZoom(100)}><Maximize2 size={17} /></IconButton>
          <IconButton label="顺时针旋转" onClick={() => setRotation((value) => (value + 90) % 360)}><RotateCw size={17} /></IconButton>
          <IconButton label={asset.favorite ? "取消收藏" : "收藏"} selected={asset.favorite} onClick={() => onFavorite(asset)}><Star size={17} fill={asset.favorite ? "currentColor" : "none"} /></IconButton>
          <IconButton label="显示信息" selected={infoVisible} onClick={() => setInfoVisible((value) => !value)}><Info size={17} /></IconButton>
        </div>
      </header>
      <div className="focus-canvas">
        <div className="focus-media" style={{ transform: `scale(${zoom / 100}) rotate(${rotation}deg)` }}><FocusMedia asset={asset} /></div>
        {infoVisible ? <div className="focus-info"><strong>{asset.displayName}</strong><span>{asset.extension} · {(asset.byteSize / 1_000_000).toFixed(1)} MB</span>{asset.width && asset.height ? <span>{asset.width} × {asset.height}</span> : null}<span>{asset.tags.map((tag) => tag.name).join(" · ") || "无标签"}</span></div> : null}
      </div>
      <div className="focus-filmstrip">
        {assets.slice(Math.max(0, currentIndex - 4), currentIndex + 5).map((item) => (
          <button type="button" key={item.id} className={item.id === asset.id ? "is-current" : ""} onClick={() => onNavigate(item)}>
            <AssetArtwork asset={item} />
          </button>
        ))}
      </div>
    </div>
  );
}
