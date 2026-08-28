import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriRuntime, libraryApi } from "../lib/tauri";
import type { UpdateState } from "../types";

interface DownloadEvent {
  event: "Started" | "Progress" | "Finished";
  data?: { chunkLength?: number; contentLength?: number };
}

interface PendingUpdate {
  version: string;
  body?: string;
  download: (callback?: (event: DownloadEvent) => void) => Promise<void>;
  install: () => Promise<void>;
  close?: () => Promise<void>;
}

const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const DEMO_VERSION = "0.1.1";

export function useAppUpdater(activeJobs: number, libraryPath?: string) {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const updateRef = useRef<PendingUpdate | null>(null);

  const checkForUpdates = useCallback(async (manual = false) => {
    if (!manual) {
      const lastCheck = Number(localStorage.getItem("libr.update.lastCheck") || 0);
      if (Date.now() - lastCheck < CHECK_INTERVAL) return;
    }
    if (manual) setState({ status: "checking" });

    if (!isTauriRuntime()) {
      window.setTimeout(() => {
        setState(manual ? { status: "upToDate", currentVersion: DEMO_VERSION } : { status: "idle" });
      }, 450);
      return;
    }

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const target = navigator.userAgent.includes("Mac") ? "darwin-universal" : undefined;
      const update = await check(target ? { target } : undefined) as PendingUpdate | null;
      localStorage.setItem("libr.update.lastCheck", String(Date.now()));
      if (!update) {
        if (manual) {
          const { getVersion } = await import("@tauri-apps/api/app");
          setState({ status: "upToDate", currentVersion: await getVersion() });
        } else {
          setState({ status: "idle" });
        }
        return;
      }
      if (localStorage.getItem("libr.update.skippedVersion") === update.version && !manual) {
        await update.close?.();
        setState({ status: "idle" });
        return;
      }
      updateRef.current = update;
      setState({ status: "available", version: update.version, notes: update.body ?? "" });
    } catch (reason) {
      setState(manual ? { status: "error", message: String(reason) } : { status: "idle" });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void checkForUpdates(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [checkForUpdates]);

  const download = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    let downloaded = 0;
    let total = 0;
    setState({ status: "downloading", version: update.version, progress: 0 });
    try {
      await update.download((event) => {
        if (event.event === "Started") total = event.data?.contentLength ?? 0;
        if (event.event === "Progress") downloaded += event.data?.chunkLength ?? 0;
        const progress = total ? Math.min(100, downloaded / total * 100) : 0;
        setState({ status: "downloading", version: update.version, progress });
      });
      setState({ status: "ready", version: update.version });
    } catch (reason) {
      setState({ status: "error", message: String(reason) });
    }
  }, []);

  const installAndRelaunch = useCallback(async () => {
    if (activeJobs > 0) {
      setState({ status: "error", message: "请等待当前导入、导出或压缩任务完成后再重启安装。" });
      return;
    }
    const update = updateRef.current;
    if (!update) return;
    try {
      await libraryApi.close();
      await update.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (reason) {
      if (libraryPath) await libraryApi.open(libraryPath).catch(() => undefined);
      setState({ status: "error", message: String(reason) });
    }
  }, [activeJobs, libraryPath]);

  const skip = useCallback((version: string) => {
    localStorage.setItem("libr.update.skippedVersion", version);
    void updateRef.current?.close?.();
    updateRef.current = null;
    setState({ status: "idle" });
  }, []);

  return {
    state,
    checkForUpdates,
    install: state.status === "ready" ? installAndRelaunch : download,
    dismiss: () => setState({ status: "idle" }),
    skip,
  };
}
