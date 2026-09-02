import { AlertTriangle, Copy, Link2, Settings2, Scissors, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ImportMode } from "../types";

export interface ImportSettings {
  mode: ImportMode;
}

interface ImportSettingsDialogProps {
  settings: ImportSettings;
  onCancel: () => void;
  onSave: (settings: ImportSettings) => void;
}

export function ImportSettingsDialog({ settings, onCancel, onSave }: ImportSettingsDialogProps) {
  const [mode, setMode] = useState<ImportMode>(settings.mode);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="import-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="import-settings-title">
        <button type="button" className="update-close" onClick={onCancel} aria-label="关闭导入配置"><X size={16} /></button>
        <div className="import-settings-heading">
          <span><Settings2 size={22} /></span>
          <div>
            <h2 id="import-settings-title">导入配置</h2>
            <p>设置文件和文件夹导入时的原文件处理方式。</p>
          </div>
        </div>

        <fieldset className="import-mode-options">
          <legend>文件存储方式</legend>
          <label className={`import-mode-option ${mode === "map" ? "is-selected" : ""}`}>
            <input type="radio" name="import-mode" checked={mode === "map"} onChange={() => setMode("map")} />
            <Link2 size={19} />
            <span><strong>映射原文件（推荐）</strong><small>只保存文件位置和缩略图，几乎不占用资源库空间</small></span>
          </label>
          <label className={`import-mode-option ${mode === "copy" ? "is-selected" : ""}`}>
            <input type="radio" name="import-mode" checked={mode === "copy"} onChange={() => setMode("copy")} />
            <Copy size={19} />
            <span><strong>复制到资源库</strong><small>资源可独立使用，但会占用与原文件相同的额外空间</small></span>
          </label>
          <label className={`import-mode-option ${mode === "move" ? "is-selected is-destructive" : ""}`}>
            <input type="radio" name="import-mode" checked={mode === "move"} onChange={() => setMode("move")} />
            <Scissors size={19} />
            <span><strong>删除原文件（剪切）</strong><small>仅删除新导入成功的文件，重复项和失败项会保留</small></span>
          </label>
        </fieldset>

        {mode === "map" ? <div className="import-settings-warning"><AlertTriangle size={17} /><span>请勿移动或删除原文件，否则 Libr 将无法读取该资源；恢复到原路径后可继续使用。</span></div> : null}
        {mode === "move" ? <div className="import-settings-warning"><AlertTriangle size={17} /><span>导入完成后原位置的文件会被删除，该操作无法在 Libr 中撤销。</span></div> : null}

        <p className="import-settings-note">此配置会保存并应用于之后的导入。</p>
        <div className="import-settings-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>取消</button>
          <button type="button" className="primary-button" onClick={() => onSave({ mode })}>保存设置</button>
        </div>
      </section>
    </div>
  );
}
