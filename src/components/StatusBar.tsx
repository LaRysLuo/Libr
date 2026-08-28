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

export function StatusBar({ selectedCount, totalCount, selectedBytes, thumbnailSize, inspectorVisible, jobProgress, onThumbnailSize, onInspectorVisible, onCancelJob }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span>已选择 {selectedCount} 项{selectedCount ? `（${formatBytes(selectedBytes)}）` : ""}</span>
      {jobProgress ? <div className="status-job"><span>{jobProgress.phase === "running" ? `正在${jobProgress.kind === "import" ? "导入" : "处理"} ${jobProgress.completed}/${jobProgress.total}` : jobProgress.phase === "complete" ? "任务已完成" : jobProgress.phase === "cancelled" ? "任务已取消" : "任务失败"}</span><span className="status-job-track"><i style={{ width: `${jobProgress.total ? jobProgress.completed / jobProgress.total * 100 : 0}%` }} /></span>{jobProgress.phase === "running" ? <button type="button" onClick={onCancelJob}>取消</button> : null}</div> : <span className="status-total">共 {totalCount.toLocaleString("zh-CN")} 项</span>}
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
