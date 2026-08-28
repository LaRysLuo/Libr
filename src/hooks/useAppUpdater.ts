import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriRuntime, libraryApi } from "../lib/tauri";
import type { UpdateState } from "../types";

interface PendingUpdate {
  version: string;
  body?: string;
  downloadAndInstall: (callback?: (event: { event: string; data?: { chunkLength?: number; contentLength?: number } }) => void) => Promise<void>;
}

const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

export function useAppUpdater(activeJobs: number) {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const updateRef = useRef<PendingUpdate | null>(null);

  const checkForUpdates = useCallback(async (manual = false) => {
    if (!isTauriRuntime()) {
      if (manual) setState({ status: "available", version: "1.1.0", notes: "• 提升大型资源库滚动性能\n• 修复部分视频封面生成问题" });
      return;
    }
    if (!manual) {
      const lastCheck = Number(localStorage.getItem("libr.update.lastCheck") || 0);
      if (Date.now() - lastCheck < CHECK_INTERVAL) return;
    }
    setState({ status: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const target = navigator.userAgent.includes("Mac") ? "darwin-universal" : undefined;
      const update = await check(target ? { target } : undefined) as PendingUpdate | null;
      localStorage.setItem("libr.update.lastCheck", String(Date.now()));
      if (!update) {
        setState({ status: "idle" });
        return;
      }
      if (localStorage.getItem("libr.update.skippedVersion") === update.version && !manual) {
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

  const install = useCallback(async () => {
    if (activeJobs > 0) {
      setState({ status: "error", message: "请等待当前导入或导出任务完成后再安装更新。" });
      return;
    }
    const update = updateRef.current;
    if (!update) {
      if (!isTauriRuntime()) {
        setState({ status: "downloading", version: "1.1.0", progress: 0 });
        let progress = 0;
        const timer = window.setInterval(() => {
          progress += 20;
          if (progress >= 100) {
            window.clearInterval(timer);
            setState({ status: "ready", version: "1.1.0" });
          } else setState({ status: "downloading", version: "1.1.0", progress });
        }, 180);
      }
      return;
    }
    let downloaded = 0;
    let total = 0;
    setState({ status: "downloading", version: update.version, progress: 0 });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data?.contentLength ?? 0;
        if (event.event === "Progress") downloaded += event.data?.chunkLength ?? 0;
        const progress = total ? Math.min(100, downloaded / total * 100) : 0;
        setState({ status: "downloading", version: update.version, progress });
      });
      setState({ status: "ready", version: update.version });
    } catch (reason) {
      setState({ status: "error", message: String(reason) });
    }
  }, [activeJobs]);

  const relaunch = useCallback(async () => {
    if (!isTauriRuntime()) {
      setState({ status: "idle" });
      return;
    }
    await libraryApi.close();
    const { relaunch: restart } = await import("@tauri-apps/plugin-process");
    await restart();
  }, []);

  return {
    state,
    checkForUpdates,
    install: state.status === "ready" ? relaunch : install,
    dismiss: () => setState({ status: "idle" }),
    skip: (version: string) => {
      localStorage.setItem("libr.update.skippedVersion", version);
      setState({ status: "idle" });
    },
  };
}
