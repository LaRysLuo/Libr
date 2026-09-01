import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { StatusBar } from "./StatusBar";

const baseProps = {
  selectedCount: 0,
  totalCount: 12,
  selectedBytes: 0,
  thumbnailSize: 164,
  inspectorVisible: true,
  onThumbnailSize: vi.fn(),
  onInspectorVisible: vi.fn(),
  onCancelJob: vi.fn(),
};

describe("StatusBar import progress", () => {
  it("shows an indeterminate progress bar while import files are being scanned", () => {
    render(<StatusBar {...baseProps} jobProgress={{
      jobId: "job-1",
      kind: "import",
      completed: 0,
      total: 0,
      phase: "queued",
      message: "正在扫描待导入文件…",
    }} />);

    expect(screen.getByText("正在准备导入")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "导入进度" })).toHaveAttribute("aria-valuetext", "正在准备导入");
  });

  it("shows real file progress and allows cancellation", () => {
    render(<StatusBar {...baseProps} jobProgress={{
      jobId: "job-2",
      kind: "import",
      completed: 3,
      total: 8,
      currentItem: "/Users/demo/视频.mp4",
      phase: "running",
    }} />);

    expect(screen.getByText("视频.mp4")).toBeInTheDocument();
    expect(screen.getByText("38%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "导入进度" })).toHaveAttribute("aria-valuenow", "3");
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });
});
