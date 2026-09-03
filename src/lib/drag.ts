import { assetApi, isTauriRuntime } from "./tauri";

export const ASSET_DRAG_TYPE = "application/x-libr-assets";
export const NATIVE_ASSET_DRAG_TARGET_EVENT = "libr:native-asset-drag-target";

let activeNativeDragPaths = new Set<string>();
let clearNativeDragTimer: number | undefined;

const parseAssetIds = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

export const hasDraggedAssets = (dataTransfer: DataTransfer) => {
  const types = Array.from(dataTransfer.types);
  return types.includes(ASSET_DRAG_TYPE) || types.includes("text/plain");
};

export const readDraggedAssetIds = (dataTransfer: DataTransfer): string[] => {
  const typedPayload = dataTransfer.getData(ASSET_DRAG_TYPE);
  if (typedPayload) return parseAssetIds(typedPayload);
  const plainPayload = dataTransfer.getData("text/plain");
  return plainPayload.startsWith("libr-assets:") ? parseAssetIds(plainPayload.slice("libr-assets:".length)) : [];
};

export const shouldIgnoreNativeAssetDrop = (paths: string[]) =>
  paths.length > 0 && paths.every((path) => activeNativeDragPaths.has(path));

export const prepareNativeAssetDrag = async (assetIds: string[]) => {
  if (!isTauriRuntime()) return null;
  return assetApi.prepareDrag(assetIds);
};

export const startNativeAssetDrag = async (
  prepared: { paths: string[]; iconPath: string },
  onDrop?: (position: { x: number; y: number }) => void,
  onFinish?: () => void,
) => {
  const { startDrag } = await import("@crabnebula/tauri-plugin-drag");
  if (clearNativeDragTimer !== undefined) window.clearTimeout(clearNativeDragTimer);
  activeNativeDragPaths = new Set(prepared.paths);
  try {
    await startDrag(
      { item: prepared.paths, icon: prepared.iconPath, mode: "copy" },
      (payload) => {
        try {
          if (payload.result === "Dropped") {
            onDrop?.({ x: Number(payload.cursorPos.x), y: Number(payload.cursorPos.y) });
          }
        } finally {
          onFinish?.();
        }
        clearNativeDragTimer = window.setTimeout(() => {
          activeNativeDragPaths.clear();
          clearNativeDragTimer = undefined;
        }, 1000);
      },
    );
  } catch (error) {
    activeNativeDragPaths.clear();
    throw error;
  }
};

export const folderIdAtScreenPosition = async (position: { x: number; y: number }) => {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const currentWindow = getCurrentWindow();
  const [innerPosition, scaleFactor] = await Promise.all([
    currentWindow.innerPosition(),
    currentWindow.scaleFactor(),
  ]);
  const clientX = position.x - innerPosition.x / scaleFactor;
  const clientY = position.y - innerPosition.y / scaleFactor;
  return document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>("[data-folder-drop-target]")
    ?.dataset.folderDropTarget;
};

export const folderIdAtCurrentCursorPosition = async () => {
  const { cursorPosition, getCurrentWindow } = await import("@tauri-apps/api/window");
  const currentWindow = getCurrentWindow();
  const [position, innerPosition, scaleFactor] = await Promise.all([
    cursorPosition(),
    currentWindow.innerPosition(),
    currentWindow.scaleFactor(),
  ]);
  const clientX = (position.x - innerPosition.x) / scaleFactor;
  const clientY = (position.y - innerPosition.y) / scaleFactor;
  return document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>("[data-folder-drop-target]")
    ?.dataset.folderDropTarget;
};

export const announceNativeAssetDragTarget = (folderId?: string | null) => {
  window.dispatchEvent(new CustomEvent<string | null>(NATIVE_ASSET_DRAG_TARGET_EVENT, {
    detail: folderId ?? null,
  }));
};
