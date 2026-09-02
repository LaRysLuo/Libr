import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { mockAssets } from "../data/mockAssets";
import { FocusPreview } from "./FocusPreview";

const renderPreview = (asset = mockAssets[0]) => render(
  <FocusPreview
    asset={asset}
    assets={[asset]}
    onClose={vi.fn()}
    onNavigate={vi.fn()}
    onFavorite={vi.fn()}
  />,
);

describe("FocusPreview wheel zoom", () => {
  it("zooms images in and out with the wheel", () => {
    renderPreview();
    const canvas = screen.getByRole("region", { name: /滚轮可缩放/ });

    fireEvent.wheel(canvas, { deltaY: -100 });
    expect(screen.getByText("125%")).toBeInTheDocument();

    fireEvent.wheel(canvas, { deltaY: 100 });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("uses smaller steps for trackpad scrolling and respects zoom bounds", () => {
    renderPreview();
    const canvas = screen.getByRole("region", { name: /滚轮可缩放/ });

    fireEvent.wheel(canvas, { deltaY: -4 });
    expect(screen.getByText("105%")).toBeInTheDocument();

    for (let index = 0; index < 20; index += 1) fireEvent.wheel(canvas, { deltaY: -100 });
    expect(screen.getByText("400%")).toBeInTheDocument();

    for (let index = 0; index < 20; index += 1) fireEvent.wheel(canvas, { deltaY: 100 });
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("does not wheel-zoom non-image previews", () => {
    const video = mockAssets.find((asset) => asset.kind === "video");
    if (!video) throw new Error("测试数据缺少视频资源");
    renderPreview(video);

    fireEvent.wheel(screen.getByRole("region", { name: "预览画布" }), { deltaY: -100 });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
