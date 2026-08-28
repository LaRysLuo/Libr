import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

describe("Libr desktop shell", () => {
  it("renders the complete library workspace", () => {
    render(<App />);
    expect(screen.getByText("资源库")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索资源库…")).toBeInTheDocument();
    expect(screen.getAllByText("DSC_0876.jpg")[0]).toBeInTheDocument();
    expect(screen.getByText("文件信息")).toBeInTheDocument();
  });

  it("filters assets from global search", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByPlaceholderText("搜索资源库…"), "背景音乐");
    expect(await screen.findByText("背景音乐.mp3")).toBeInTheDocument();
    expect(screen.queryByText("城市延时.mp4")).not.toBeInTheDocument();
  });

  it("opens and closes immersive preview", async () => {
    const user = userEvent.setup();
    render(<App />);
    const caption = screen.getAllByText("DSC_0876.jpg")[0];
    const card = caption.closest(".asset-card");
    expect(card).not.toBeNull();
    await user.dblClick(card!);
    const dialog = screen.getByRole("dialog", { name: "预览 DSC_0876.jpg" });
    expect(within(dialog).getByText("1 / 19")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "关闭预览" }));
    expect(screen.queryByRole("dialog", { name: "预览 DSC_0876.jpg" })).not.toBeInTheDocument();
  });

  it("provides feedback for the import action in browser preview", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^导入/ }));
    expect(await screen.findByText(/导入入口工作正常/)).toBeInTheDocument();
  });

  it("creates folders and applies compound asset filters", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "新建文件夹" }));
    await user.type(screen.getByLabelText("文件夹名称"), "待整理");
    await user.click(screen.getByRole("button", { name: "添加" }));
    expect(screen.getAllByText("待整理")[0]).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("形状筛选"), "portrait");
    expect(screen.getByText("人像_侧脸.jpg")).toBeInTheDocument();
    expect(screen.queryByText("城市延时.mp4")).not.toBeInTheDocument();
  });

  it("runs the manual update state flow", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "我的素材.libr" }));
    await user.click(screen.getByRole("button", { name: /检查更新/ }));
    const dialog = screen.getByRole("dialog", { name: "应用更新" });
    expect(within(dialog).getByText("发现新版本 1.1.0")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "跳过此版本" }));
    expect(screen.queryByRole("dialog", { name: "应用更新" })).not.toBeInTheDocument();
  });
});
