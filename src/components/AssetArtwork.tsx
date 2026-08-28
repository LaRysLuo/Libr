import { FileArchive, FileCode2, FileText, Type } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import type { Asset } from "../types";

interface AssetArtworkProps {
  asset: Asset;
  large?: boolean;
}

const waveform = [18, 34, 52, 28, 66, 44, 74, 38, 58, 86, 50, 72, 40, 62, 30, 78, 48, 68, 36, 58, 26, 72, 42, 56, 22, 60, 34, 48, 18];

export const AssetArtwork = memo(function AssetArtwork({ asset, large = false }: AssetArtworkProps) {
  const style = useMemo(() => asset.previewUrl ? { backgroundImage: `url(${asset.previewUrl})` } : undefined, [asset.previewUrl]);
  const showVideoFrame = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.min(0.1, video.duration / 2);
    }
  }, []);

  if (asset.previewUrl) {
    return <div className="asset-image" style={style} role="img" aria-label={asset.displayName} />;
  }

  if (asset.kind === "video" && asset.assetUrl) {
    return (
      <video
        className="asset-video-thumbnail"
        src={asset.assetUrl}
        preload="metadata"
        muted
        playsInline
        aria-label={`${asset.displayName} 视频缩略图`}
        onLoadedMetadata={showVideoFrame}
      />
    );
  }

  if (asset.kind === "audio") {
    return (
      <div className="generated-artwork audio-artwork" style={{ background: asset.dominantColor ?? "#246bfe" }}>
        <div className="waveform" aria-hidden="true">
          {waveform.map((height, index) => <span key={index} style={{ height: `${large ? height * 1.35 : height}%` }} />)}
        </div>
      </div>
    );
  }

  if (asset.id === "asset-forms") {
    return (
      <div className="generated-artwork forms-artwork">
        <span className="shape shape-cube" />
        <span className="shape shape-tall" />
        <span className="shape shape-ball" />
        <span className="shape shape-floor" />
      </div>
    );
  }

  if (asset.id === "asset-logo") {
    return (
      <div className="generated-artwork logo-artwork">
        <span /><span /><span />
      </div>
    );
  }

  if (asset.id === "asset-brandbook") {
    return (
      <div className="generated-artwork brandbook-artwork">
        <small>⌘</small><strong>BRAND<br />GUIDELINES</strong><i>2026</i>
      </div>
    );
  }

  if (asset.id === "asset-font") {
    return (
      <div className="generated-artwork font-artwork"><span>Aa</span><small>TYPOGRAPHY / 字体系统</small></div>
    );
  }

  if (asset.id === "asset-vinyl") {
    return (
      <div className="generated-artwork vinyl-artwork"><span className="vinyl-cover">archive</span><span className="vinyl-disc" /></div>
    );
  }

  if (asset.id === "asset-architecture") {
    return (
      <div className="generated-artwork architecture-artwork"><span /><span /></div>
    );
  }

  if (asset.id === "asset-design") {
    return (
      <div className="generated-artwork design-artwork"><strong>Design System</strong><span className="design-swatch swatch-a" /><span className="design-swatch swatch-b" /><span className="design-swatch swatch-c" /></div>
    );
  }

  const icon = asset.kind === "font"
    ? <Type size={large ? 58 : 38} />
    : asset.kind === "archive"
      ? <FileArchive size={large ? 58 : 38} />
      : asset.extension.match(/^(JS|TS|JSON|CSS|HTML)$/)
        ? <FileCode2 size={large ? 58 : 38} />
        : <FileText size={large ? 58 : 38} />;

  return (
    <div className="generated-artwork document-artwork">
      <div className="document-sheet">
        <span className="doc-ribbon">{asset.extension.slice(0, 1)}</span>
        {icon}
        <strong>{asset.displayName.replace(/\.[^.]+$/, "")}</strong>
      </div>
    </div>
  );
});
