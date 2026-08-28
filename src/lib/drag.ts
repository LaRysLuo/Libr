export const ASSET_DRAG_TYPE = "application/x-libr-assets";

export const readDraggedAssetIds = (dataTransfer: DataTransfer): string[] => {
  try {
    const parsed = JSON.parse(dataTransfer.getData(ASSET_DRAG_TYPE));
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
};
