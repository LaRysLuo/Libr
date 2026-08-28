import { Check, ChevronDown, Download, ExternalLink, Plus, RotateCcw, Star, Trash2 } from "lucide-react";
import { memo, useState } from "react";
import type { Asset, AssetPatch, Folder, Tag } from "../types";
import { AssetArtwork } from "./AssetArtwork";

interface InspectorProps {
  asset: Asset | null;
  selectionCount: number;
  availableTags: Tag[];
  folders: Folder[];
  onUpdate: (assetId: string, patch: AssetPatch) => void;
  onOpenExternal: (asset: Asset) => void;
  onTrash: (asset: Asset) => void;
  onRestore: (asset: Asset) => void;
  onPurge: (asset: Asset) => void;
  onExport: (asset: Asset) => void;
}

const colors = ["#ef4444", "#f97316", "#facc15", "#48a83f", "#19a9d5", "#a855f7", "#7b7f86"];

const formatBytes = (bytes: number) => {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
};

const formatDate = (date: string) => new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(date));

export const Inspector = memo(function Inspector({ asset, selectionCount, availableTags, folders, onUpdate, onOpenExternal, onTrash, onRestore, onPurge, onExport }: InspectorProps) {
  const [draftNotes, setDraftNotes] = useState(asset?.notes ?? "");
  const [picker, setPicker] = useState<"tags" | "folders" | null>(null);

  if (!asset) {
    return (
      <aside className="inspector inspector-empty">
        <div className="inspector-placeholder"><Check size={22} /><span>{selectionCount > 1 ? `已选择 ${selectionCount} 项` : "选择资源以查看详情"}</span></div>
      </aside>
    );
  }

  return (
    <aside className="inspector" key={asset.id}>
      <div className="inspector-title-row">
        <span className="inspector-filename" title={asset.displayName}>{asset.displayName}</span>
        <button type="button" aria-label={asset.favorite ? "取消收藏" : "收藏"} onClick={() => onUpdate(asset.id, { favorite: !asset.favorite })}>
          <Star size={17} fill={asset.favorite ? "currentColor" : "none"} className={asset.favorite ? "star-active" : ""} />
        </button>
      </div>
      <div className="inspector-preview"><AssetArtwork asset={asset} large /></div>

      <div className="rating-row" aria-label="资源评分">
        {[1, 2, 3, 4, 5].map((rating) => (
          <button key={rating} type="button" aria-label={`${rating} 星`} onClick={() => onUpdate(asset.id, { rating })}>
            <Star size={17} fill={rating <= asset.rating ? "currentColor" : "none"} />
          </button>
        ))}
        <ChevronDown size={13} />
      </div>

      <section className="inspector-section">
        <h3>颜色标签</h3>
        <div className="color-row">
          {colors.map((color) => (
            <button
              type="button"
              key={color}
              className={`color-dot ${asset.colorLabel === color ? "is-selected" : ""}`}
              style={{ backgroundColor: color }}
              onClick={() => onUpdate(asset.id, asset.colorLabel === color ? { colorLabel: null, clearColorLabel: true } : { colorLabel: color })}
              aria-label={`设置颜色 ${color}`}
            />
          ))}
        </div>
      </section>

      <section className="inspector-section">
        <h3>标签</h3>
        <div className="tag-list">
          {asset.tags.map((tag) => <span key={tag.id}>{tag.name}<button type="button" aria-label={`移除标签 ${tag.name}`} onClick={() => onUpdate(asset.id, { tagIds: asset.tags.filter((item) => item.id !== tag.id).map((item) => item.id) })}>×</button></span>)}
          <button type="button" className="add-tag" aria-label="添加标签" onClick={() => setPicker(picker === "tags" ? null : "tags")}><Plus size={14} /></button>
        </div>
        {picker === "tags" ? <div className="inspector-picker">{availableTags.map((tag) => <button type="button" key={tag.id} className={asset.tags.some((item) => item.id === tag.id) ? "is-active" : ""} onClick={() => onUpdate(asset.id, { tagIds: asset.tags.some((item) => item.id === tag.id) ? asset.tags.filter((item) => item.id !== tag.id).map((item) => item.id) : [...asset.tags.map((item) => item.id), tag.id] })}>{tag.name}</button>)}</div> : null}
      </section>

      <section className="inspector-section">
        <h3>所在文件夹</h3>
        <div className="tag-list folder-list">{folders.filter((folder) => asset.folderIds.includes(folder.id)).map((folder) => <span key={folder.id}>{folder.name}<button type="button" aria-label={`移出文件夹 ${folder.name}`} onClick={() => onUpdate(asset.id, { folderIds: asset.folderIds.filter((id) => id !== folder.id) })}>×</button></span>)}<button type="button" className="add-tag" aria-label="添加到文件夹" onClick={() => setPicker(picker === "folders" ? null : "folders")}><Plus size={14} /></button></div>
        {picker === "folders" ? <div className="inspector-picker">{folders.map((folder) => <button type="button" key={folder.id} className={asset.folderIds.includes(folder.id) ? "is-active" : ""} onClick={() => onUpdate(asset.id, { folderIds: asset.folderIds.includes(folder.id) ? asset.folderIds.filter((id) => id !== folder.id) : [...asset.folderIds, folder.id] })}>{folder.name}</button>)}</div> : null}
      </section>

      <section className="inspector-section notes-section">
        <h3>备注</h3>
        <textarea
          defaultValue={asset.notes}
          placeholder="添加关于这项资源的备注…"
          onChange={(event) => setDraftNotes(event.target.value)}
          onBlur={() => draftNotes !== asset.notes && onUpdate(asset.id, { notes: draftNotes })}
        />
      </section>

      <section className="inspector-section metadata-section">
        <h3>文件信息</h3>
        <dl>
          <dt>类型</dt><dd>{asset.extension} {asset.kind === "image" ? "图像" : asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : "文件"}</dd>
          {asset.width && asset.height ? <><dt>尺寸</dt><dd>{asset.width} × {asset.height}</dd></> : null}
          <dt>大小</dt><dd>{formatBytes(asset.byteSize)}</dd>
          {asset.dominantColor ? <><dt>主色</dt><dd><span className="metadata-color" style={{ background: asset.dominantColor }} />{asset.dominantColor}</dd></> : null}
          <dt>创建时间</dt><dd>{formatDate(asset.createdAt)}</dd>
          <dt>导入时间</dt><dd>{formatDate(asset.importedAt)}</dd>
          <dt>文件路径</dt><dd className="path-value" title={asset.sourcePath}>{asset.sourcePath}</dd>
        </dl>
      </section>

      <div className="inspector-footer">
        {asset.deletedAt ? <><button type="button" className="secondary-button" onClick={() => onRestore(asset)}><RotateCcw size={14} />恢复资源</button><button type="button" className="secondary-button square-button danger-button" aria-label="永久删除" onClick={() => onPurge(asset)}><Trash2 size={16} /></button></> : <><button type="button" className="secondary-button" onClick={() => onOpenExternal(asset)}><ExternalLink size={14} />在系统中打开</button><button type="button" className="secondary-button square-button" aria-label="导出资源" onClick={() => onExport(asset)}><Download size={16} /></button><button type="button" className="secondary-button square-button danger-button" aria-label="移到回收站" onClick={() => onTrash(asset)}><Trash2 size={16} /></button></>}
      </div>
    </aside>
  );
});
