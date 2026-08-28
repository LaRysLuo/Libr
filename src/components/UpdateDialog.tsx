import { AlertCircle, CheckCircle2, Download, LoaderCircle, RefreshCw, X } from "lucide-react";
import type { UpdateState } from "../types";

interface UpdateDialogProps {
  state: UpdateState;
  onDismiss: () => void;
  onSkip: (version: string) => void;
  onInstall: () => void;
  onCheck: () => void;
}

export function UpdateDialog({ state, onDismiss, onSkip, onInstall, onCheck }: UpdateDialogProps) {
  if (state.status === "idle") return null;
  const busy = state.status === "checking" || state.status === "downloading";
  const version = "version" in state ? state.version : null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="update-dialog" role="dialog" aria-modal="true" aria-label="应用更新">
        <button type="button" className="update-close" onClick={onDismiss} aria-label="关闭" disabled={busy}><X size={16} /></button>
        <span className={`update-icon ${state.status === "ready" || state.status === "upToDate" ? "is-ready" : ""} ${state.status === "error" ? "is-error" : ""}`}>
          {state.status === "checking" || state.status === "downloading" ? <LoaderCircle size={23} className="spin" />
            : state.status === "ready" || state.status === "upToDate" ? <CheckCircle2 size={23} />
              : state.status === "error" ? <AlertCircle size={23} />
                : <Download size={23} />}
        </span>
        <div className="update-copy">
          {state.status === "checking" ? <><h2>正在检查更新</h2><p>正在连接 GitHub Release 获取最新版本信息…</p></> : null}
          {state.status === "upToDate" ? <><h2>Libr 已是最新版本</h2><p>当前版本 {state.currentVersion}，暂时没有可用更新。</p></> : null}
          {state.status === "available" ? <><h2>发现新版本 {state.version}</h2><p>{state.notes || "包含性能优化与问题修复。"}</p></> : null}
          {state.status === "downloading" ? <><h2>正在下载 Libr {state.version}</h2><div className="update-progress"><span style={{ width: `${state.progress}%` }} /><small>{Math.round(state.progress)}%</small></div></> : null}
          {state.status === "ready" ? <><h2>更新已准备好</h2><p>安装包已通过 Ed25519 签名校验。Libr 会先安全关闭当前资源库，再安装并重启。</p></> : null}
          {state.status === "error" ? <><h2>无法检查或安装更新</h2><p>{state.message}</p></> : null}

          <div className="update-actions">
            {state.status === "available" && version ? <button type="button" className="text-button" onClick={() => onSkip(version)}>跳过此版本</button> : null}
            {state.status === "available" ? <button type="button" className="secondary-button" onClick={onDismiss}>稍后提醒</button> : null}
            {state.status === "available" ? <button type="button" className="primary-button" onClick={onInstall}>下载更新</button> : null}
            {state.status === "ready" ? <><button type="button" className="secondary-button" onClick={onDismiss}>稍后安装</button><button type="button" className="primary-button" onClick={onInstall}>重启并安装</button></> : null}
            {state.status === "upToDate" ? <button type="button" className="primary-button" onClick={onDismiss}>完成</button> : null}
            {state.status === "error" ? <><button type="button" className="secondary-button" onClick={onDismiss}>关闭</button><button type="button" className="primary-button" onClick={onCheck}><RefreshCw size={14} />重新检查</button></> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
