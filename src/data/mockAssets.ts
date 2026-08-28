import type { Asset, Folder, SmartFolder, Tag } from "../types";

const now = "2026-08-28T09:42:00+08:00";
const mountain = "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=900&q=86";
const city = "https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=900&q=86";
const portrait = "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=900&q=86";
const snow = "https://images.unsplash.com/photo-1517299321609-52687d1bc55a?auto=format&fit=crop&w=900&q=86";
const interior = "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=900&q=86";
const leaf = "https://images.unsplash.com/photo-1520412099551-62b6bafeb5bb?auto=format&fit=crop&w=900&q=86";
const forest = "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=900&q=86";
const beach = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=86";
const product = "https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=900&q=86";

const tag = (id: string, name: string): Tag => ({ id, name });

export const mockAssets: Asset[] = [
  {
    id: "asset-mountain",
    displayName: "DSC_0876.jpg",
    extension: "JPG",
    kind: "image",
    mime: "image/jpeg",
    byteSize: 4_200_000,
    width: 6000,
    height: 4000,
    rating: 5,
    favorite: true,
    colorLabel: "#2d9cdb",
    dominantColor: "#486b75",
    notes: "在加拿大班夫国家公园拍摄，清晨的光线与湖面倒影非常漂亮。",
    sourcePath: "/素材库/摄影/风景/DSC_0876.jpg",
    importedAt: now,
    createdAt: "2024-05-12T08:31:00+08:00",
    folderIds: ["folder-landscape"],
    tags: [tag("tag-landscape", "风景"), tag("tag-nature", "自然"), tag("tag-mountain", "山脉"), tag("tag-lake", "湖泊")],
    previewUrl: mountain,
  },
  { id: "asset-city", displayName: "城市延时.mp4", extension: "MP4", kind: "video", mime: "video/mp4", byteSize: 84_200_000, width: 3840, height: 2160, durationMs: 15_000, rating: 0, favorite: false, notes: "", sourcePath: "/素材库/视频/城市延时.mp4", importedAt: now, createdAt: now, folderIds: ["folder-video"], tags: [tag("tag-city", "城市")], previewUrl: city },
  { id: "asset-forms", displayName: "3D渲染场景.png", extension: "PNG", kind: "image", mime: "image/png", byteSize: 2_800_000, width: 2400, height: 2400, rating: 0, favorite: false, notes: "", sourcePath: "/素材库/UIUX/3D渲染场景.png", importedAt: now, createdAt: now, folderIds: ["folder-ui"], tags: [], dominantColor: "#b9d6d2" },
  { id: "asset-portrait", displayName: "人像_侧脸.jpg", extension: "JPG", kind: "image", mime: "image/jpeg", byteSize: 5_200_000, width: 4000, height: 5000, rating: 4, favorite: false, notes: "", sourcePath: "/素材库/摄影/人像_侧脸.jpg", importedAt: now, createdAt: now, folderIds: ["folder-portrait"], tags: [tag("tag-portrait", "人像")], previewUrl: portrait },
  { id: "asset-snow", displayName: "沙漠风景.jpg", extension: "JPG", kind: "image", mime: "image/jpeg", byteSize: 3_600_000, width: 5000, height: 3333, rating: 0, favorite: false, notes: "", sourcePath: "/素材库/摄影/风景/沙漠风景.jpg", importedAt: now, createdAt: now, folderIds: ["folder-landscape"], tags: [tag("tag-landscape", "风景")], previewUrl: snow },
  { id: "asset-logo", displayName: "logo_方案A.svg", extension: "SVG", kind: "image", mime: "image/svg+xml", byteSize: 82_000, width: 1600, height: 1200, rating: 0, favorite: true, notes: "品牌图形探索", sourcePath: "/素材库/品牌设计/logo_方案A.svg", importedAt: now, createdAt: now, folderIds: ["folder-brand"], tags: [tag("tag-brand", "品牌")], dominantColor: "#0e3444" },
  { id: "asset-audio", displayName: "背景音乐.mp3", extension: "MP3", kind: "audio", mime: "audio/mpeg", byteSize: 9_800_000, durationMs: 222_000, rating: 0, favorite: false, notes: "", sourcePath: "/素材库/音频/背景音乐.mp3", importedAt: now, createdAt: now, folderIds: ["folder-audio"], tags: [tag("tag-music", "音乐")], dominantColor: "#2867e9" },
  { id: "asset-brandbook", displayName: "品牌手册.pdf", extension: "PDF", kind: "pdf", mime: "application/pdf", byteSize: 12_600_000, rating: 0, favorite: false, notes: "2026 品牌系统", sourcePath: "/素材库/品牌设计/品牌手册.pdf", importedAt: now, createdAt: now, folderIds: ["folder-brand"], tags: [tag("tag-brand", "品牌")] },
  { id: "asset-product", displayName: "香水瓶_静物.jpg", extension: "JPG", kind: "image", mime: "image/jpeg", byteSize: 4_900_000, width: 4200, height: 4200, rating: 0, favorite: false, notes: "", sourcePath: "/素材库/摄影/静物/香水瓶_静物.jpg", importedAt: now, createdAt: now, folderIds: ["folder-still"], tags: [tag("tag-product", "产品")], previewUrl: product },
  { id: "asset-app", displayName: "App界面设计.sketch", extension: "SKETCH", kind: "document", mime: "application/octet-stream", byteSize: 24_300_000, rating: 0, favorite: false, notes: "", sourcePath: "/素材库/UIUX/App界面设计.sketch", importedAt: now, createdAt: now, folderIds: ["folder-ui"], tags: [tag("tag-app", "App")] },
  { id: "asset-interior", displayName: "室内设计.jpg", extension: "JPG", kind: "image", mime: "image/jpeg", byteSize: 6_800_000, width: 5500, height: 3667, rating: 0, favorite: false, notes: "", sourcePath: "/素材库/摄影/室内设计.jpg", importedAt: now, createdAt: now, folderIds: ["folder-still"], tags: [tag("tag-interior", "室内")], previewUrl: interior },
  { id: "asset-leaf", displayName: "绿植特写.jpg", extension: "JPG", kind: "image", mime: "image/jpeg", byteSize: 5_400_000, width: 4000, height: 5000, rating: 4, favorite: true, notes: "", sourcePath: "/素材库/摄影/绿植特写.jpg", importedAt: now, createdAt: now, folderIds: ["folder-still"], tags: [tag("tag-nature", "自然")], previewUrl: leaf },
  { id: "asset-forest", displayName: "森林清晨.mov", extension: "MOV", kind: "video", mime: "video/quicktime", byteSize: 114_300_000, durationMs: 28_000, rating: 0, favorite: false, notes: "", sourcePath: "/素材库/视频/森林清晨.mov", importedAt: now, createdAt: now, folderIds: ["folder-video"], tags: [tag("tag-nature", "自然")], previewUrl: forest },
  { id: "asset-font", displayName: "字体排版.png", extension: "PNG", kind: "image", mime: "image/png", byteSize: 1_200_000, width: 1800, height: 2400, rating: 0, favorite: false, notes: "", sourcePath: "/素材库/品牌设计/字体排版.png", importedAt: now, createdAt: now, folderIds: ["folder-brand"], tags: [tag("tag-font", "字体")] },
  { id: "asset-docx", displayName: "需求文档.docx", extension: "DOCX", kind: "document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byteSize: 820_000, rating: 0, favorite: false, notes: "", sourcePath: "/素材库/文档/需求文档.docx", importedAt: now, createdAt: now, folderIds: ["folder-doc"], tags: [] },
  { id: "asset-vinyl", displayName: "黑胶唱片.jpg", extension: "JPG", kind: "image", mime: "image/jpeg", byteSize: 2_400_000, width: 3200, height: 3200, rating: 0, favorite: false, notes: "", sourcePath: "/素材库/摄影/静物/黑胶唱片.jpg", importedAt: now, createdAt: now, folderIds: ["folder-still"], tags: [tag("tag-music", "音乐")], dominantColor: "#9f3e2a" },
  { id: "asset-architecture", displayName: "极简建筑.jpg", extension: "JPG", kind: "image", mime: "image/jpeg", byteSize: 3_100_000, width: 4200, height: 4200, rating: 0, favorite: false, notes: "", sourcePath: "/素材库/摄影/极简建筑.jpg", importedAt: now, createdAt: now, folderIds: ["folder-landscape"], tags: [tag("tag-architecture", "建筑")], dominantColor: "#c6d8df" },
  { id: "asset-design", displayName: "设计规范.pdf", extension: "PDF", kind: "pdf", mime: "application/pdf", byteSize: 8_200_000, rating: 0, favorite: false, notes: "", sourcePath: "/素材库/UIUX/设计规范.pdf", importedAt: now, createdAt: now, folderIds: ["folder-ui"], tags: [tag("tag-system", "设计系统")] },
  { id: "asset-beach", displayName: "度假人像.jpg", extension: "JPG", kind: "image", mime: "image/jpeg", byteSize: 4_700_000, width: 4200, height: 5600, rating: 0, favorite: false, notes: "", sourcePath: "/素材库/摄影/人像/度假人像.jpg", importedAt: now, createdAt: now, folderIds: ["folder-portrait"], tags: [tag("tag-portrait", "人像")], previewUrl: beach },
];

export const mockFolders: Folder[] = [
  { id: "folder-project", name: "项目", itemCount: 448, sortOrder: 0 },
  { id: "folder-brand", parentId: "folder-project", name: "品牌设计", itemCount: 230, sortOrder: 0 },
  { id: "folder-marketing", parentId: "folder-project", name: "宣传物料", itemCount: 86, sortOrder: 1 },
  { id: "folder-ui", parentId: "folder-project", name: "UI/UX", itemCount: 132, sortOrder: 2 },
  { id: "folder-photo", name: "摄影", itemCount: 412, sortOrder: 1 },
  { id: "folder-landscape", parentId: "folder-photo", name: "风景", itemCount: 208, sortOrder: 0 },
  { id: "folder-portrait", parentId: "folder-photo", name: "人像", itemCount: 124, sortOrder: 1 },
  { id: "folder-still", parentId: "folder-photo", name: "静物", itemCount: 80, sortOrder: 2 },
  { id: "folder-video", name: "视频", itemCount: 156, sortOrder: 2 },
  { id: "folder-audio", name: "音频", itemCount: 98, sortOrder: 3 },
  { id: "folder-doc", name: "文档", itemCount: 64, sortOrder: 4 },
  { id: "folder-source", name: "素材源文件", itemCount: 90, sortOrder: 5 },
];

export const mockSmartFolders: SmartFolder[] = [
  { id: "smart-today", name: "今日导入", itemCount: 28, query: { version: 1, operator: "and", rules: [{ field: "importedAt", operator: "after", value: "today" }] } },
  { id: "smart-week", name: "本周导入", itemCount: 96, query: { version: 1, operator: "and", rules: [{ field: "importedAt", operator: "after", value: "week" }] } },
  { id: "smart-large", name: "大尺寸文件", itemCount: 120, query: { version: 1, operator: "and", rules: [{ field: "size", operator: "gte", value: 20_000_000 }] } },
  { id: "smart-untagged", name: "未标注标签", itemCount: 215, query: { version: 1, operator: "and", rules: [{ field: "untagged", operator: "is", value: true }] } },
  { id: "smart-unused", name: "未使用", itemCount: 342, query: { version: 1, operator: "and", rules: [] } },
];
