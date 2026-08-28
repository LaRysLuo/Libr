import { ChevronDown, RotateCcw, Star } from "lucide-react";
import type { AspectFilter, DateFilter, SizeFilter } from "../hooks/useLibraryController";
import type { AssetKind, Folder, Tag } from "../types";

interface FilterBarProps {
  kind: AssetKind | "all";
  rating: number;
  tags: Tag[];
  folders: Folder[];
  tagId: string;
  folderId: string;
  color: string;
  size: SizeFilter;
  date: DateFilter;
  aspect: AspectFilter;
  expanded: boolean;
  onKind: (value: AssetKind | "all") => void;
  onRating: (value: number) => void;
  onTag: (value: string) => void;
  onFolder: (value: string) => void;
  onColor: (value: string) => void;
  onSize: (value: SizeFilter) => void;
  onDate: (value: DateFilter) => void;
  onAspect: (value: AspectFilter) => void;
  onMore: () => void;
  onReset: () => void;
}

const typeLabels: Array<[AssetKind | "all", string]> = [
  ["all", "所有类型"],
  ["image", "图片"],
  ["video", "视频"],
  ["audio", "音频"],
  ["pdf", "PDF"],
  ["document", "文档"],
];

export function FilterBar({ kind, rating, tags, folders, tagId, folderId, color, size, date, aspect, expanded, onKind, onRating, onTag, onFolder, onColor, onSize, onDate, onAspect, onMore, onReset }: FilterBarProps) {
  return (
    <div className={`filter-bar ${expanded ? "is-expanded" : ""}`}>
      <label className="filter-select">
        <select value={kind} onChange={(event) => onKind(event.target.value as AssetKind | "all")}>
          {typeLabels.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <ChevronDown size={13} />
      </label>
      <label className="filter-select"><select aria-label="标签筛选" value={tagId} onChange={(event) => onTag(event.target.value)}><option value="">全部标签</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><ChevronDown size={13} /></label>
      <label className="filter-select"><select aria-label="文件夹筛选" value={folderId} onChange={(event) => onFolder(event.target.value)}><option value="">全部文件夹</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><ChevronDown size={13} /></label>
      <label className="filter-select"><select aria-label="颜色筛选" value={color} onChange={(event) => onColor(event.target.value)}><option value="">全部颜色</option><option value="#ef4444">红色</option><option value="#f97316">橙色</option><option value="#facc15">黄色</option><option value="#48a83f">绿色</option><option value="#19a9d5">蓝色</option><option value="#a855f7">紫色</option></select><ChevronDown size={13} /></label>
      <label className="filter-select rating-filter">
        <Star size={13} />
        <select value={rating} onChange={(event) => onRating(Number(event.target.value))}>
          <option value={0}>评分</option>
          <option value={1}>1 星以上</option>
          <option value={2}>2 星以上</option>
          <option value={3}>3 星以上</option>
          <option value={4}>4 星以上</option>
          <option value={5}>5 星</option>
        </select>
        <ChevronDown size={13} />
      </label>
      <label className="filter-select"><select aria-label="形状筛选" value={aspect} onChange={(event) => onAspect(event.target.value as AspectFilter)}><option value="all">所有形状</option><option value="landscape">横向</option><option value="portrait">纵向</option><option value="square">方形</option></select><ChevronDown size={13} /></label>
      {expanded ? (
        <>
          <label className="filter-select"><select aria-label="大小筛选" value={size} onChange={(event) => onSize(event.target.value as SizeFilter)}><option value="all">所有大小</option><option value="small">小于 1 MB</option><option value="medium">1–20 MB</option><option value="large">大于 20 MB</option></select><ChevronDown size={13} /></label>
          <label className="filter-select"><select aria-label="导入日期筛选" value={date} onChange={(event) => onDate(event.target.value as DateFilter)}><option value="all">所有日期</option><option value="today">今天</option><option value="week">最近 7 天</option><option value="month">最近 30 天</option></select><ChevronDown size={13} /></label>
        </>
      ) : <button type="button" className="filter-button" onClick={onMore}>更多筛选 <ChevronDown size={13} /></button>}
      <span className="filter-spacer" />
      <button type="button" className="filter-reset" onClick={onReset}><RotateCcw size={13} /> 重置</button>
    </div>
  );
}
