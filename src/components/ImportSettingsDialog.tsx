import { AlertTriangle, Copy, Settings2, Scissors, X } from "lucide-react";
import { useEffect, useState } from "react";

export interface ImportSettings {
  deleteOriginals: boolean;
}

interface ImportSettingsDialogProps {
  settings: ImportSettings;
  onCancel: () => void;
  onSave: (settings: ImportSettings) => void;
}

export function ImportSettingsDialog({ settings, onCancel, onSave }: ImportSettingsDialogProps) {
  const [deleteOriginals, setDeleteOriginals] = useState(settings.deleteOriginals);

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
          <legend>原文件处理</legend>
          <label className={`import-mode-option ${!deleteOriginals ? "is-selected" : ""}`}>
            <input type="radio" name="import-mode" checked={!deleteOriginals} onChange={() => setDeleteOriginals(false)} />
            <Copy size={19} />
            <span><strong>保留原文件</strong><small>复制内容到资源库，原位置文件不变</small></span>
          </label>
          <label className={`import-mode-option ${deleteOriginals ? "is-selected is-destructive" : ""}`}>
            <input type="radio" name="import-mode" checked={deleteOriginals} onChange={() => setDeleteOriginals(true)} />
            <Scissors size={19} />
            <span><strong>删除原文件（剪切）</strong><small>仅删除新导入成功的文件，重复项和失败项会保留</small></span>
          </label>
        </fieldset>

        {deleteOriginals ? <div className="import-settings-warning"><AlertTriangle size={17} /><span>导入完成后原位置的文件会被删除，该操作无法在 Libr 中撤销。</span></div> : null}

        <p className="import-settings-note">此配置会保存并应用于之后的导入。</p>
        <div className="import-settings-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>取消</button>
          <button type="button" className="primary-button" onClick={() => onSave({ deleteOriginals })}>保存设置</button>
        </div>
      </section>
    </div>
  );
}
