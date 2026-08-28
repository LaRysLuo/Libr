import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    await user.click(screen.getByRole("button", { name: "应用设置" }));
    await user.click(screen.getByRole("button", { name: /检查更新/ }));
    const dialog = screen.getByRole("dialog", { name: "应用更新" });
    expect(within(dialog).getByText("正在检查更新")).toBeInTheDocument();
    expect(await within(dialog).findByText("Libr 已是最新版本")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "完成" }));
    expect(screen.queryByRole("dialog", { name: "应用更新" })).not.toBeInTheDocument();
  });

  it("derives sidebar counts from live asset state", async () => {
    const user = userEvent.setup();
    render(<App />);
    const countFor = (label: string) => within(screen.getByText(label).closest("button")!).getByText(/^\d+$/);

    expect(countFor("全部资源")).toHaveTextContent("19");
    expect(countFor("收藏")).toHaveTextContent("3");
    expect(countFor("回收站")).toHaveTextContent("0");

    const inspector = document.querySelector(".inspector")!;
    await user.click(within(inspector as HTMLElement).getByRole("button", { name: "取消收藏" }));
    expect(countFor("收藏")).toHaveTextContent("2");
    await user.click(within(inspector as HTMLElement).getByRole("button", { name: "移到回收站" }));
    expect(countFor("全部资源")).toHaveTextContent("18");
    expect(countFor("回收站")).toHaveTextContent("1");
  });

  it("assigns selected assets by dragging them onto a folder", async () => {
    render(<App />);
    const transferData = new Map<string, string>();
    const transferTypes: string[] = [];
    const dataTransfer = {
      effectAllowed: "none",
      dropEffect: "none",
      types: transferTypes,
      setData(type: string, value: string) {
        transferData.set(type, value);
        if (!transferTypes.includes(type)) transferTypes.push(type);
      },
      getData(type: string) {
        return transferData.get(type) ?? "";
      },
    } as unknown as DataTransfer;

    const card = screen.getAllByText("DSC_0876.jpg")[0].closest(".asset-card")!;
    const folderRow = screen.getAllByText("文档").find((element) => element.classList.contains("sidebar-label"))!.closest("button")!;
    expect(within(folderRow).getByText("1")).toBeInTheDocument();
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(folderRow, { dataTransfer });
    expect(folderRow).toHaveClass("is-drop-target");
    fireEvent.drop(folderRow, { dataTransfer });
    await waitFor(() => expect(within(folderRow).getByText("2")).toBeInTheDocument());
    expect(await screen.findByText(/已将 1 项资源添加到“文档”/)).toBeInTheDocument();
  });
});
