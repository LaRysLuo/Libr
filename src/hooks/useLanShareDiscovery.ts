import { useCallback, useEffect, useState } from "react";
import { isTauriRuntime, lanShareApi } from "../lib/tauri";
import type { DiscoveredLanShare } from "../types";

const browserPreviewShares: DiscoveredLanShare[] = [
  {
    id: "preview-lan-share",
    deviceName: "小王的 MacBook",
    folderName: "团队素材",
    permission: "readOnly",
    url: "http://192.168.2.35:41783/share/demo-access-token",
  },
];

export function useLanShareDiscovery() {
  const [shares, setShares] = useState<DiscoveredLanShare[]>(() =>
    isTauriRuntime() ? [] : browserPreviewShares,
  );

  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setShares(await lanShareApi.discovered());
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    let dispose: (() => void) | undefined;
    const refreshWhileActive = () => {
      void refresh().catch(() => undefined);
    };

    refreshWhileActive();
    const timer = window.setInterval(refreshWhileActive, 5_000);
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const unlisten = await listen("lan-shares-changed", refreshWhileActive);
      if (active) dispose = unlisten;
      else unlisten();
    }).catch(() => undefined);

    return () => {
      active = false;
      window.clearInterval(timer);
      dispose?.();
    };
  }, [refresh]);

  return { shares, refresh };
}
