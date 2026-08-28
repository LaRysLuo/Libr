import { CheckCircle2, Download, LoaderCircle, X } from "lucide-react";
import type { UpdateState } from "../types";

interface UpdateDialogProps {
  state: UpdateState;
  onDismiss: () => void;
  onSkip: (version: string) => void;
  onInstall: () => void;
}

export function UpdateDialog({ state, onDismiss, onSkip, onInstall }: UpdateDialogProps) {
  if (state.status !== "available" && state.status !== "downloading" && state.status !== "ready") return null;
  const version = state.version;
  return (
    <div className="update-dialog" role="dialog" aria-label="应用更新">
      <button type="button" className="update-close" onClick={onDismiss} aria-label="关闭"><X size={15} /></button>
      <span className={`update-icon ${state.status === "ready" ? "is-ready" : ""}`}>
        {state.status === "downloading" ? <LoaderCircle size={21} className="spin" /> : state.status === "ready" ? <CheckCircle2 size={21} /> : <Download size={21} />}
      </span>
      <div className="update-copy">
        <h2>{state.status === "ready" ? "更新已准备好" : `发现新版本 ${version}`}</h2>
        {state.status === "available" ? <p>{state.notes || "包含性能优化与问题修复。"}</p> : null}
        {state.status === "downloading" ? (
          <div className="update-progress"><span style={{ width: `${state.progress}%` }} /><small>正在下载… {Math.round(state.progress)}%</small></div>
        ) : null}
        {state.status === "ready" ? <p>安装包已通过签名校验，重启 Libr 即可完成更新。</p> : null}
        <div className="update-actions">
          {state.status === "available" ? <button type="button" className="text-button" onClick={() => onSkip(version)}>跳过此版本</button> : null}
          <button type="button" className="secondary-button" onClick={onDismiss}>稍后提醒</button>
          <button type="button" className="primary-button" disabled={state.status === "downloading"} onClick={onInstall}>
            {state.status === "ready" ? "重启并安装" : "下载并安装"}
          </button>
        </div>
      </div>
    </div>
  );
}
