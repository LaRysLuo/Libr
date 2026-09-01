import { Check, Copy, FolderOpen, Globe2, ShieldCheck, Square, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Folder, LanShareInfo } from "../types";

interface LanShareDialogProps {
  folders: Folder[];
  libraryReadOnly: boolean;
  info: LanShareInfo;
  initialFolderId: string;
  onClose: () => void;
  onStart: (folderId: string, allowEditing: boolean) => Promise<LanShareInfo>;
  onStop: () => Promise<void>;
}

export function LanShareDialog({ folders, libraryReadOnly, info, initialFolderId, onClose, onStart, onStop }: LanShareDialogProps) {
  const availableFolders = useMemo(() => folders.filter((folder) => !folder.isLocked && !folder.isEncrypted), [folders]);
  const [folderId, setFolderId] = useState(() => initialFolderId ?? info.folderId ?? availableFolders[0]?.id ?? "");
  const [allowEditing, setAllowEditing] = useState(() => info.permission === "manage" && !libraryReadOnly);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  const start = async () => {
    if (!folderId) return;
    setBusy(true);
    setError("");
    try {
      await onStart(folderId, allowEditing);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError("");
    try {
      await onStop();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    if (!info.url) return;
    try {
      await navigator.clipboard.writeText(info.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("无法写入剪贴板，请手动复制链接");
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="lan-share-dialog" role="dialog" aria-modal="true" aria-label="局域网共享">
        <button type="button" className="update-close" onClick={onClose} aria-label="关闭" disabled={busy}><X size={16} /></button>
        <div className="lan-share-heading">
          <span className={`lan-share-icon ${info.active ? "is-active" : ""}`}><Globe2 size={24} /></span>
          <div>
            <h2>局域网共享</h2>
            <p>让同一 Wi-Fi 或有线网络内的设备通过浏览器访问。</p>
          </div>
        </div>

        {info.active ? (
          <div className="lan-share-active">
            <div className="share-status-line"><span><i />正在共享</span><strong>{info.folderName}</strong></div>
            <label className="share-url-field">
              <span>访问链接</span>
              <div><input readOnly value={info.url ?? ""} aria-label="局域网共享链接" onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={() => void copyUrl()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "已复制" : "复制"}</button></div>
            </label>
            <div className="share-detail-card">
              <ShieldCheck size={18} />
              <div><strong>{info.permission === "manage" ? "可管理" : "仅查看"}</strong><span>{info.permission === "manage" ? "访问者可下载、重命名、收藏和移到回收站" : "访问者可查看预览并下载资源"}</span></div>
            </div>
            <p className="share-security-note">链接包含随机访问凭证；只分享给信任的局域网成员。关闭 Libr 或切换资源库后会自动停止。</p>
            <div className="lan-share-actions"><button type="button" className="secondary-button share-stop-button" onClick={() => void stop()} disabled={busy}><Square size={13} />{busy ? "正在停止…" : "停止共享"}</button><button type="button" className="primary-button" onClick={onClose} disabled={busy}>完成</button></div>
          </div>
        ) : (
          <div className="lan-share-setup">
            <label>
              <span>共享文件夹</span>
              <div className="share-select-wrap"><FolderOpen size={16} /><select aria-label="共享文件夹" value={folderId} onChange={(event) => setFolderId(event.target.value)} disabled={busy}><option value="" disabled>选择文件夹</option>{availableFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name} ({folder.itemCount})</option>)}</select></div>
            </label>
            {availableFolders.length === 0 ? <p className="share-empty-folders">没有可共享的普通文件夹。已加密的文件夹不会出现在此处。</p> : null}
            <fieldset>
              <legend>访问权限</legend>
              <label className={`share-permission ${!allowEditing ? "is-selected" : ""}`}><input type="radio" name="share-permission" checked={!allowEditing} onChange={() => setAllowEditing(false)} disabled={busy} /><ShieldCheck size={18} /><span><strong>仅查看</strong><small>可预览和下载，不能修改资源库</small></span></label>
              <label className={`share-permission ${allowEditing ? "is-selected" : ""} ${libraryReadOnly ? "is-disabled" : ""}`}><input type="radio" name="share-permission" checked={allowEditing} onChange={() => setAllowEditing(true)} disabled={busy || libraryReadOnly} /><Globe2 size={18} /><span><strong>可管理</strong><small>可下载、重命名、收藏和移到回收站</small></span></label>
            </fieldset>
            <div className="share-detail-card"><ShieldCheck size={18} /><div><strong>安全边界</strong><span>共享包含子文件夹，但会自动排除已加密或已锁定的内容。</span></div></div>
            <div className="folder-password-error" aria-live="polite">{error}</div>
            <div className="lan-share-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>取消</button><button type="button" className="primary-button" onClick={() => void start()} disabled={busy || !folderId}>{busy ? "正在启动…" : "开始共享"}</button></div>
          </div>
        )}
        {info.active && error ? <div className="folder-password-error share-active-error" aria-live="polite">{error}</div> : null}
      </section>
    </div>
  );
}
