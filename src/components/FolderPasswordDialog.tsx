import { AlertCircle, KeyRound, LockKeyhole, ShieldOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Folder } from "../types";

export type FolderPasswordMode = "encrypt" | "unlock" | "remove";

interface FolderPasswordDialogProps {
  folder: Folder;
  mode: FolderPasswordMode;
  onCancel: () => void;
  onSubmit: (password: string) => Promise<boolean>;
}

const copyFor = {
  encrypt: {
    title: "加密文件夹",
    description: "设置一个正好 8 位的密码。加密后，必须先解锁才能查看文件夹中的内容。",
    action: "确认加密",
  },
  unlock: {
    title: "解锁文件夹",
    description: "输入加密时设置的 8 位密码。关闭资源库后，文件夹会自动恢复锁定。",
    action: "解锁并查看",
  },
  remove: {
    title: "取消文件夹加密",
    description: "输入当前密码确认。取消后，文件夹内容将不再需要密码即可查看。",
    action: "取消加密",
  },
} satisfies Record<FolderPasswordMode, { title: string; description: string; action: string }>;

export function FolderPasswordDialog({ folder, mode, onCancel, onSubmit }: FolderPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const copy = copyFor[mode];
  const passwordLength = Array.from(password).length;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (passwordLength !== 8 || password.trim() !== password) {
      setError("请输入正好 8 位的密码，且不要包含首尾空格");
      return;
    }
    if (mode === "encrypt" && confirmation !== password) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const succeeded = await onSubmit(password);
      if (!succeeded) setError(mode === "encrypt" ? "无法设置密码，请检查后重试" : "密码不正确，请重新输入");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <section className="folder-password-dialog" role="dialog" aria-modal="true" aria-label={copy.title}>
        <button type="button" className="update-close" onClick={onCancel} aria-label="关闭" disabled={busy}><X size={16} /></button>
        <span className={`folder-password-icon ${mode === "remove" ? "is-remove" : ""}`}>
          {mode === "unlock" ? <KeyRound size={23} /> : mode === "remove" ? <ShieldOff size={23} /> : <LockKeyhole size={23} />}
        </span>
        <form className="folder-password-form" onSubmit={(event) => void submit(event)}>
          <h2>{copy.title}</h2>
          <p className="folder-password-name">“{folder.name}”</p>
          <p>{copy.description}</p>
          <label>
            <span>{mode === "encrypt" ? "设置密码" : "输入密码"}</span>
            <div className="password-input-wrap">
              <input
                autoFocus
                type="password"
                inputMode="text"
                autoComplete={mode === "encrypt" ? "new-password" : "current-password"}
                aria-label={mode === "encrypt" ? "设置 8 位密码" : "输入 8 位密码"}
                value={password}
                onChange={(event) => { setPassword(event.target.value); setError(""); }}
                disabled={busy}
              />
              <small className={passwordLength === 8 ? "is-valid" : ""}>{passwordLength}/8</small>
            </div>
          </label>
          {mode === "encrypt" ? (
            <label>
              <span>确认密码</span>
              <input type="password" autoComplete="new-password" aria-label="再次输入密码" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setError(""); }} disabled={busy} />
            </label>
          ) : null}
          <div className="folder-password-error" aria-live="polite">{error ? <><AlertCircle size={13} />{error}</> : null}</div>
          <div className="folder-password-actions">
            <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>取消</button>
            <button type="submit" className={`primary-button ${mode === "remove" ? "is-danger" : ""}`} disabled={busy || passwordLength !== 8 || (mode === "encrypt" && confirmation.length === 0)}>{busy ? "处理中…" : copy.action}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
