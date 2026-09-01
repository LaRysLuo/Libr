import { Check, ChevronDown, Download, ExternalLink, Plus, RotateCcw, Star, Trash2 } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import { useDismissibleLayer } from "../hooks/useDismissibleLayer";
import type { Asset, AssetPatch, Folder, Tag } from "../types";
import { AssetArtwork } from "./AssetArtwork";

type AssetPatchInput = AssetPatch | ((asset: Asset) => AssetPatch);

interface InspectorProps {
  assets: Asset[];
  availableTags: Tag[];
  folders: Folder[];
  onUpdate: (assetIds: string[], patch: AssetPatchInput) => void;
  onCreateTag: (name: string) => Promise<Tag | null>;
  onOpenExternal: (asset: Asset) => void;
  onTrash: (assets: Asset[]) => void;
  onRestore: (assets: Asset[]) => void;
  onPurge: (assets: Asset[]) => void;
  onExport: (assets: Asset[]) => void;
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

function NotesEditor({ assets, onCommit }: { assets: Asset[]; onCommit: (notes: string) => void }) {
  const sharedNotes = assets.every((item) => item.notes === assets[0]?.notes) ? assets[0]?.notes ?? "" : "";
  const [draft, setDraft] = useState(sharedNotes);
  const [dirty, setDirty] = useState(false);
  return (
    <textarea
      value={draft}
      placeholder={assets.length > 1 && !sharedNotes ? `为所选 ${assets.length} 项批量添加备注…` : "添加关于这项资源的备注…"}
      onChange={(event) => { setDraft(event.target.value); setDirty(true); }}
      onBlur={() => { if (dirty) onCommit(draft); setDirty(false); }}
    />
  );
}

export const Inspector = memo(function Inspector({ assets, availableTags, folders, onUpdate, onCreateTag, onOpenExternal, onTrash, onRestore, onPurge, onExport }: InspectorProps) {
  const [picker, setPicker] = useState<"tags" | "folders" | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const tagPickerRef = useRef<HTMLElement>(null);
  const folderPickerRef = useRef<HTMLElement>(null);
  const asset = assets.at(-1) ?? null;
  const assetIds = useMemo(() => assets.map((item) => item.id), [assets]);
  const selectionKey = assetIds.join(":");
  const allFavorite = assets.length > 0 && assets.every((item) => item.favorite);
  const sharedRating = asset && assets.every((item) => item.rating === asset.rating) ? asset.rating : null;
  const sharedColor = asset && assets.every((item) => item.colorLabel === asset.colorLabel) ? asset.colorLabel : null;
  const visibleTags = useMemo(() => {
    const union = new Map<string, Tag>();
    for (const item of assets) for (const tag of item.tags) union.set(tag.id, tag);
    return [...union.values()];
  }, [assets]);
  const selectedFolders = useMemo(() => folders.filter((folder) => assets.some((item) => item.folderIds.includes(folder.id))), [assets, folders]);

  useDismissibleLayer({
    open: picker === "tags",
    layerRef: tagPickerRef,
    onDismiss: () => setPicker(null),
  });
  useDismissibleLayer({
    open: picker === "folders",
    layerRef: folderPickerRef,
    onDismiss: () => setPicker(null),
  });

  if (!asset) {
    return (
      <aside className="inspector inspector-empty">
        <div className="inspector-placeholder"><Check size={22} /><span>选择资源以查看详情</span></div>
      </aside>
    );
  }

  const toggleTag = (tag: Tag) => {
    const removeFromAll = assets.every((item) => item.tags.some((current) => current.id === tag.id));
    onUpdate(assetIds, (item) => ({
      tagIds: removeFromAll
        ? item.tags.filter((current) => current.id !== tag.id).map((current) => current.id)
        : [...new Set([...item.tags.map((current) => current.id), tag.id])],
    }));
  };

  const toggleFolder = (folderId: string) => {
    const removeFromAll = assets.every((item) => item.folderIds.includes(folderId));
    onUpdate(assetIds, (item) => ({
      folderIds: removeFromAll
        ? item.folderIds.filter((id) => id !== folderId)
        : [...new Set([...item.folderIds, folderId])],
    }));
  };

  const createAndAssignTag = async (event: React.FormEvent) => {
    event.preventDefault();
    const created = await onCreateTag(newTagName);
    if (!created) return;
    setNewTagName("");
    onUpdate(assetIds, (item) => ({ tagIds: [...new Set([...item.tags.map((tag) => tag.id), created.id])] }));
  };

  const multiple = assets.length > 1;
  const allDeleted = assets.every((item) => Boolean(item.deletedAt));
  const totalBytes = assets.reduce((sum, item) => sum + item.byteSize, 0);

  return (
    <aside className={`inspector ${multiple ? "is-batch" : ""}`}>
      <div className="inspector-title-row">
        <span className="inspector-filename" title={multiple ? `${assets.length} 项资源` : asset.displayName}>{multiple ? `已选择 ${assets.length} 项` : asset.displayName}</span>
        <button type="button" aria-label={allFavorite ? "取消收藏所选资源" : "收藏所选资源"} onClick={() => onUpdate(assetIds, { favorite: !allFavorite })}>
          <Star size={17} fill={allFavorite ? "currentColor" : "none"} className={allFavorite ? "star-active" : ""} />
        </button>
      </div>
      <div className="inspector-preview">
        <AssetArtwork asset={asset} large />
        {multiple ? <span className="batch-preview-badge">{assets.length} 项</span> : null}
      </div>

      <div className={`rating-row ${sharedRating === null ? "is-mixed" : ""}`} aria-label={multiple ? "批量资源评分" : "资源评分"}>
        {[1, 2, 3, 4, 5].map((rating) => (
          <button key={rating} type="button" aria-label={`设为 ${rating} 星`} onClick={() => onUpdate(assetIds, { rating })}>
            <Star size={17} fill={sharedRating !== null && rating <= sharedRating ? "currentColor" : "none"} />
          </button>
        ))}
        <ChevronDown size={13} />
        {multiple ? <span className="batch-field-hint">应用到 {assets.length} 项</span> : null}
      </div>

      <section className="inspector-section">
        <h3>颜色标签{multiple ? <small>批量</small> : null}</h3>
        <div className="color-row">
          {colors.map((color) => (
            <button
              type="button"
              key={color}
              className={`color-dot ${sharedColor === color ? "is-selected" : ""}`}
              style={{ backgroundColor: color }}
              onClick={() => onUpdate(assetIds, sharedColor === color ? { colorLabel: null, clearColorLabel: true } : { colorLabel: color })}
              aria-label={`设置颜色 ${color}`}
            />
          ))}
        </div>
      </section>

      <section ref={tagPickerRef} className="inspector-section">
        <h3>标签{multiple ? <small>批量</small> : null}</h3>
        <div className="tag-list">
          {visibleTags.map((tag) => {
            const onEveryAsset = assets.every((item) => item.tags.some((current) => current.id === tag.id));
            return <span key={tag.id} className={onEveryAsset ? "" : "is-partial"} title={onEveryAsset ? undefined : "仅部分所选资源包含此标签"}>{tag.name}<button type="button" aria-label={`移除标签 ${tag.name}`} onClick={() => { if (onEveryAsset) toggleTag(tag); else onUpdate(assetIds, (item) => ({ tagIds: item.tags.filter((current) => current.id !== tag.id).map((current) => current.id) })); }}>×</button></span>;
          })}
          <button type="button" className="add-tag" aria-label="添加标签" aria-expanded={picker === "tags"} aria-controls="tag-picker" onClick={() => setPicker(picker === "tags" ? null : "tags")}><Plus size={14} /></button>
        </div>
        {picker === "tags" ? (
          <div id="tag-picker" className="inspector-picker-panel">
            <div className="inspector-picker">
              {availableTags.map((tag) => {
                const count = assets.filter((item) => item.tags.some((current) => current.id === tag.id)).length;
                return <button type="button" key={tag.id} className={count === assets.length ? "is-active" : count > 0 ? "is-partial" : ""} onClick={() => toggleTag(tag)}>{tag.name}{count > 0 && count < assets.length ? ` (${count}/${assets.length})` : ""}</button>;
              })}
            </div>
            <form className="tag-create-form" onSubmit={(event) => void createAndAssignTag(event)}>
              <input aria-label="新标签名称" placeholder="新建标签…" value={newTagName} onChange={(event) => setNewTagName(event.target.value)} />
              <button type="submit" disabled={!newTagName.trim()}>创建并添加</button>
            </form>
          </div>
        ) : null}
      </section>

      <section ref={folderPickerRef} className="inspector-section">
        <h3>所在文件夹{multiple ? <small>批量</small> : null}</h3>
        <div className="tag-list folder-list">
          {selectedFolders.map((folder) => {
            const onEveryAsset = assets.every((item) => item.folderIds.includes(folder.id));
            return <span key={folder.id} className={onEveryAsset ? "" : "is-partial"}>{folder.name}<button type="button" aria-label={`移出文件夹 ${folder.name}`} onClick={() => { if (onEveryAsset) toggleFolder(folder.id); else onUpdate(assetIds, (item) => ({ folderIds: item.folderIds.filter((id) => id !== folder.id) })); }}>×</button></span>;
          })}
          <button type="button" className="add-tag" aria-label="添加到文件夹" aria-expanded={picker === "folders"} aria-controls="folder-picker" onClick={() => setPicker(picker === "folders" ? null : "folders")}><Plus size={14} /></button>
        </div>
        {picker === "folders" ? <div id="folder-picker" className="inspector-picker">{folders.map((folder) => {
          const count = assets.filter((item) => item.folderIds.includes(folder.id)).length;
          return <button type="button" key={folder.id} className={count === assets.length ? "is-active" : count > 0 ? "is-partial" : ""} onClick={() => toggleFolder(folder.id)}>{folder.name}{count > 0 && count < assets.length ? ` (${count}/${assets.length})` : ""}</button>;
        })}</div> : null}
      </section>

      <section className="inspector-section notes-section">
        <h3>备注{multiple ? <small>批量</small> : null}</h3>
        <NotesEditor key={selectionKey} assets={assets} onCommit={(notes) => onUpdate(assetIds, { notes })} />
      </section>

      <section className="inspector-section metadata-section">
        <h3>文件信息</h3>
        {multiple ? (
          <dl>
            <dt>所选文件</dt><dd>{assets.length} 项</dd>
            <dt>类型</dt><dd>{new Set(assets.map((item) => item.kind)).size} 种</dd>
            <dt>总大小</dt><dd>{formatBytes(totalBytes)}</dd>
          </dl>
        ) : (
          <dl>
            <dt>类型</dt><dd>{asset.extension} {asset.kind === "image" ? "图像" : asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : "文件"}</dd>
            {asset.width && asset.height ? <><dt>尺寸</dt><dd>{asset.width} × {asset.height}</dd></> : null}
            <dt>大小</dt><dd>{formatBytes(asset.byteSize)}</dd>
            {asset.dominantColor ? <><dt>主色</dt><dd><span className="metadata-color" style={{ background: asset.dominantColor }} />{asset.dominantColor}</dd></> : null}
            <dt>创建时间</dt><dd>{formatDate(asset.createdAt)}</dd>
            <dt>导入时间</dt><dd>{formatDate(asset.importedAt)}</dd>
            <dt>文件路径</dt><dd className="path-value" title={asset.sourcePath}>{asset.sourcePath}</dd>
          </dl>
        )}
      </section>

      <div className="inspector-footer">
        {allDeleted ? <><button type="button" className="secondary-button" onClick={() => onRestore(assets)}><RotateCcw size={14} />恢复{multiple ? `${assets.length} 项` : "资源"}</button><button type="button" className="secondary-button square-button danger-button" aria-label="永久删除所选资源" onClick={() => onPurge(assets)}><Trash2 size={16} /></button></> : <><button type="button" className="secondary-button" disabled={multiple} title={multiple ? "仅支持打开单个资源" : undefined} onClick={() => onOpenExternal(asset)}><ExternalLink size={14} />{multiple ? "请选择单项" : "在系统中打开"}</button><button type="button" className="secondary-button square-button" aria-label="导出所选资源" onClick={() => onExport(assets)}><Download size={16} /></button><button type="button" className="secondary-button square-button danger-button" aria-label="将所选资源移到回收站" onClick={() => onTrash(assets)}><Trash2 size={16} /></button></>}
      </div>
    </aside>
  );
});
