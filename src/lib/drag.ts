export const ASSET_DRAG_TYPE = "application/x-libr-assets";

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
