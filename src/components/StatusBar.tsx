import { Image as ImageIcon, List, Minus, Plus } from "lucide-react";
import { IconButton } from "./IconButton";
import type { JobProgress } from "../types";

interface StatusBarProps {
  selectedCount: number;
  totalCount: number;
  selectedBytes: number;
  thumbnailSize: number;
  inspectorVisible: boolean;
  jobProgress: JobProgress | null;
  onThumbnailSize: (size: number) => void;
  onInspectorVisible: (visible: boolean) => void;
  onCancelJob: () => void;
}

const formatBytes = (bytes: number) => bytes ? `${(bytes / 1_000_000).toFixed(1)} MB` : "0 B";

const currentFilename = (path?: string) => path?.split(/[\\/]/).pop();

const progressTitle = (jobProgress: JobProgress) => {
  if (jobProgress.phase === "queued") return "正在准备导入";
  if (jobProgress.phase === "running") return "正在导入资源";
  if (jobProgress.phase === "complete") return "导入完成";
  if (jobProgress.phase === "cancelled") return "导入已取消";
  return "导入失败";
};

export function StatusBar({ selectedCount, totalCount, selectedBytes, thumbnailSize, inspectorVisible, jobProgress, onThumbnailSize, onInspectorVisible, onCancelJob }: StatusBarProps) {
  const percentage = jobProgress?.total
    ? Math.min(100, Math.round(jobProgress.completed / jobProgress.total * 100))
    : 0;
  const isActiveImport = jobProgress?.kind === "import" && (jobProgress.phase === "queued" || jobProgress.phase === "running");
  const filename = currentFilename(jobProgress?.currentItem);

  return (
    <footer className="status-bar">
      <span>已选择 {selectedCount} 项{selectedCount ? `（${formatBytes(selectedBytes)}）` : ""}</span>
      {jobProgress?.kind === "import" ? (
        <section className={`status-job is-${jobProgress.phase}`} role="status" aria-live="polite" aria-label="导入进度">
          <div className="status-job-heading">
            <strong>{progressTitle(jobProgress)}</strong>
            <span>{jobProgress.total ? `${percentage}%` : "准备中"}</span>
          </div>
          <span className="status-job-current" title={jobProgress.currentItem ?? jobProgress.message}>
            {filename ?? jobProgress.message ?? "正在处理导入任务…"}
          </span>
          <div className="status-job-progress-row">
            <span
              className={`status-job-track ${jobProgress.total ? "" : "is-indeterminate"}`}
              role="progressbar"
              aria-label="导入进度"
              aria-valuemin={0}
              aria-valuemax={jobProgress.total || undefined}
              aria-valuenow={jobProgress.total ? jobProgress.completed : undefined}
              aria-valuetext={jobProgress.total ? `${jobProgress.completed} / ${jobProgress.total}` : "正在准备导入"}
            >
              <i style={{ width: `${percentage}%` }} />
            </span>
            <span className="status-job-count">{jobProgress.total ? `${jobProgress.completed} / ${jobProgress.total}` : ""}</span>
            {jobProgress.phase === "running" ? <button type="button" onClick={onCancelJob}>取消</button> : null}
          </div>
        </section>
      ) : <span className="status-total">共 {totalCount.toLocaleString("zh-CN")} 项</span>}
      {isActiveImport ? <span className="sr-only">导入任务进行中</span> : null}
      <div className="status-controls">
        <Minus size={13} />
        <input
          type="range"
          min={128}
          max={240}
          value={thumbnailSize}
          onChange={(event) => onThumbnailSize(Number(event.target.value))}
          aria-label="缩略图大小"
        />
        <Plus size={13} />
        <IconButton label="列表密度（列表视图可用）" disabled><List size={14} /></IconButton>
        <IconButton label="显示或隐藏详情" selected={inspectorVisible} onClick={() => onInspectorVisible(!inspectorVisible)}><ImageIcon size={14} /></IconButton>
      </div>
    </footer>
  );
}
