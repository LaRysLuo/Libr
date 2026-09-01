import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import App from "./App";
import { mockAssets } from "./data/mockAssets";

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

  it("renames an asset inline without replacing its extension", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "重命名 DSC_0876.jpg" }));
    const input = screen.getByRole("textbox", { name: "重命名 DSC_0876.jpg" }) as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("DSC_0876".length);

    await user.keyboard("旅行照片");
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("textbox", { name: "重命名 DSC_0876.jpg" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重命名 旅行照片.jpg" })).toBeInTheDocument();
    expect(document.querySelector(".inspector-filename")).toHaveTextContent("旅行照片.jpg");
  });

  it("cancels an inline rename with Escape", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "重命名 DSC_0876.jpg" }));
    const input = screen.getByRole("textbox", { name: "重命名 DSC_0876.jpg" });
    await user.clear(input);
    await user.type(input, "不保存.jpg");
    await user.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "重命名 DSC_0876.jpg" })).toBeInTheDocument();
    expect(screen.queryByText("不保存.jpg")).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "导入文件" }));
    expect(await screen.findByText(/导入入口工作正常/)).toBeInTheDocument();
  });

  it("offers recursive folder import from the import menu", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "显示导入选项" }));
    const menu = screen.getByRole("menu", { name: "导入选项" });
    expect(within(menu).getByText("包含所有子文件夹中的文件")).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: /导入文件夹/ }));

    expect(screen.queryByRole("menu", { name: "导入选项" })).not.toBeInTheDocument();
    expect(await screen.findByText(/所有子文件夹中的文件/)).toBeInTheDocument();
  });

  it("starts a permission-scoped LAN folder share", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /\.libr$/ }));
    expect(within(screen.getByRole("menu", { name: "资源库操作" })).queryByRole("menuitem", { name: /局域网共享/ })).not.toBeInTheDocument();
    await user.click(screen.getByPlaceholderText("搜索资源库…"));
    await user.click(screen.getByRole("button", { name: "文件夹操作 素材源文件" }));
    const folderMenu = screen.getByRole("menu", { name: "文件夹操作 素材源文件" });
    expect(within(folderMenu).getByRole("menuitem", { name: "加密" })).toBeInTheDocument();
    await user.click(within(folderMenu).getByRole("menuitem", { name: "局域网共享" }));
    const dialog = screen.getByRole("dialog", { name: "局域网共享" });
    expect(within(dialog).getByLabelText("共享文件夹")).toHaveValue("folder-source");
    await user.click(within(dialog).getByRole("radio", { name: /可管理/ }));
    await user.click(within(dialog).getByRole("button", { name: "开始共享" }));

    expect(await within(dialog).findByText("正在共享")).toBeInTheDocument();
    expect((within(dialog).getByLabelText("局域网共享链接") as HTMLInputElement).value).toMatch(/^http:\/\/192\.168\.1\.23:/);
    expect(within(dialog).getByText("访问者可下载、重命名、收藏和移到回收站")).toBeInTheDocument();
  });

  it("dismisses dropdown menus and pickers when clicking elsewhere", async () => {
    const user = userEvent.setup();
    render(<App />);
    const search = screen.getByPlaceholderText("搜索资源库…");

    await user.click(screen.getByRole("button", { name: /\.libr$/ }));
    expect(screen.getByRole("menu", { name: "资源库操作" })).toBeInTheDocument();
    await user.click(search);
    expect(screen.queryByRole("menu", { name: "资源库操作" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "应用设置" }));
    expect(screen.getByRole("menu", { name: "应用操作" })).toBeInTheDocument();
    await user.click(search);
    expect(screen.queryByRole("menu", { name: "应用操作" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "显示导入选项" }));
    expect(screen.getByRole("menu", { name: "导入选项" })).toBeInTheDocument();
    await user.click(search);
    expect(screen.queryByRole("menu", { name: "导入选项" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加标签" }));
    expect(screen.getByRole("textbox", { name: "新标签名称" })).toBeInTheDocument();
    await user.click(search);
    expect(screen.queryByRole("textbox", { name: "新标签名称" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "文件夹操作 文档" }));
    expect(screen.getByRole("menu", { name: "文件夹操作 文档" })).toBeInTheDocument();
    await user.click(search);
    expect(screen.queryByRole("menu", { name: "文件夹操作 文档" })).not.toBeInTheDocument();

    const card = screen.getAllByText("DSC_0876.jpg")[0].closest(".asset-card")!;
    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });
    expect(screen.getByRole("menu", { name: "资源操作" })).toBeInTheDocument();
    await user.click(search);
    expect(screen.queryByRole("menu", { name: "资源操作" })).not.toBeInTheDocument();
  });

  it("moves assets to trash from a red context-menu action", async () => {
    const user = userEvent.setup();
    render(<App />);
    const card = screen.getAllByText("DSC_0876.jpg")[0].closest(".asset-card")!;

    expect(fireEvent.contextMenu(card, { clientX: 240, clientY: 180 })).toBe(false);
    const menu = screen.getByRole("menu", { name: "资源操作" });
    const deleteItem = within(menu).getByRole("menuitem", { name: "移到回收站" });
    expect(deleteItem).toHaveClass("is-danger");

    await user.click(deleteItem);
    expect(screen.queryByRole("menu", { name: "资源操作" })).not.toBeInTheDocument();
    expect(screen.queryByText("DSC_0876.jpg")).not.toBeInTheDocument();
    expect(await screen.findByText("“DSC_0876.jpg”已移到回收站")).toBeInTheDocument();
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

  it("encrypts a folder and requires its 8-character password before showing contents", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "文件夹操作 文档" }));
    await user.click(within(screen.getByRole("menu", { name: "文件夹操作 文档" })).getByRole("menuitem", { name: "加密" }));
    const encryptDialog = screen.getByRole("dialog", { name: "加密文件夹" });
    await user.type(within(encryptDialog).getByLabelText("设置 8 位密码"), "12345678");
    await user.type(within(encryptDialog).getByLabelText("再次输入密码"), "12345678");
    await user.click(within(encryptDialog).getByRole("button", { name: "确认加密" }));

    expect(await screen.findByText("“文档”已加密并锁定")).toBeInTheDocument();
    expect(screen.queryByText("需求文档.docx")).not.toBeInTheDocument();
    const folderRow = screen.getAllByText("文档").find((element) => element.classList.contains("sidebar-label"))!.closest("button")!;
    expect(within(folderRow).getByLabelText("已锁定")).toBeInTheDocument();

    await user.click(folderRow);
    const unlockDialog = screen.getByRole("dialog", { name: "解锁文件夹" });
    const passwordInput = within(unlockDialog).getByLabelText("输入 8 位密码");
    await user.type(passwordInput, "87654321");
    await user.click(within(unlockDialog).getByRole("button", { name: "解锁并查看" }));
    expect(await within(unlockDialog).findByText("密码不正确，请重新输入")).toBeInTheDocument();
    await user.clear(passwordInput);
    await user.type(passwordInput, "12345678");
    await user.click(within(unlockDialog).getByRole("button", { name: "解锁并查看" }));

    expect(await screen.findByText("需求文档.docx")).toBeInTheDocument();
    expect(await screen.findByText("“文档”已解锁")).toBeInTheDocument();
  });

  it("runs the manual update state flow", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "应用设置" }));
    await user.click(within(screen.getByRole("menu", { name: "应用操作" })).getByRole("menuitem", { name: /检查更新/ }));
    const dialog = screen.getByRole("dialog", { name: "应用更新" });
    expect(within(dialog).getByText("正在检查更新")).toBeInTheDocument();
    expect(await within(dialog).findByText("Libr 已是最新版本")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "完成" }));
    expect(screen.queryByRole("dialog", { name: "应用更新" })).not.toBeInTheDocument();
  });

  it("toggles dark mode and remembers the preference", async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem("libr:theme");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "应用设置" }));
    const appMenu = screen.getByRole("menu", { name: "应用操作" });
    await user.click(within(appMenu).getByRole("menuitem", { name: "深色模式" }));

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem("libr:theme")).toBe("dark");
    expect(within(appMenu).getByRole("menuitem", { name: "浅色模式" })).toHaveAttribute("aria-pressed", "true");

    window.localStorage.removeItem("libr:theme");
  });

  it("derives sidebar counts from live asset state", async () => {
    const user = userEvent.setup();
    render(<App />);
    const countFor = (label: string) => within(screen.getByText(label).closest("button")!).getByText(/^\d+$/);

    expect(countFor("全部资源")).toHaveTextContent("19");
    expect(countFor("收藏")).toHaveTextContent("3");
    expect(countFor("回收站")).toHaveTextContent("0");

    const inspector = document.querySelector(".inspector")!;
    await user.click(within(inspector as HTMLElement).getByRole("button", { name: "取消收藏所选资源" }));
    expect(countFor("收藏")).toHaveTextContent("2");
    await user.click(within(inspector as HTMLElement).getByRole("button", { name: "将所选资源移到回收站" }));
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
    expect(within(folderRow).getByText("松开添加")).toBeInTheDocument();
    fireEvent.drop(folderRow, { dataTransfer });
    await waitFor(() => expect(within(folderRow).getByText("2")).toBeInTheDocument());
    expect(await screen.findByText(/已将 1 项资源添加到“文档”/)).toBeInTheDocument();
  });

  it("uses a compact pointer preview and folder feedback during desktop dragging", async () => {
    render(<App />);
    const card = screen.getAllByText("DSC_0876.jpg")[0].closest(".asset-card")!;
    const folderRow = screen.getAllByText("素材源文件").find((element) => element.classList.contains("sidebar-label"))!.closest("button")!;
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => folderRow });
    const pointerEvent = (type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
      Object.defineProperty(event, "pointerId", { value: 7 });
      return event;
    };

    try {
      fireEvent(card, pointerEvent("pointerdown", 400, 200));
      fireEvent(window, pointerEvent("pointermove", 120, 640));
      expect(document.documentElement).toHaveClass("is-asset-dragging");
      expect(document.querySelector(".asset-drag-preview")).not.toBeNull();
      expect(folderRow).toHaveClass("is-drop-target");
      fireEvent(window, pointerEvent("pointerup", 120, 640));
      await waitFor(() => expect(within(folderRow).getByText("1")).toBeInTheDocument());
      expect(await screen.findByText(/已将 1 项资源添加到“素材源文件”/)).toBeInTheDocument();
      expect(document.documentElement).not.toHaveClass("is-asset-dragging");
      expect(document.querySelector(".asset-drag-preview")).toBeNull();
    } finally {
      if (originalElementFromPoint) Object.defineProperty(document, "elementFromPoint", { configurable: true, value: originalElementFromPoint });
      else Reflect.deleteProperty(document, "elementFromPoint");
    }
  });

  it("shows a real video frame surface and keeps audio controls stateful", async () => {
    const user = userEvent.setup();
    const video = mockAssets.find((asset) => asset.id === "asset-city")!;
    const audio = mockAssets.find((asset) => asset.id === "asset-audio")!;
    const originalVideoPreview = video.previewUrl;
    const originalVideoUrl = video.assetUrl;
    const originalAudioUrl = audio.assetUrl;
    video.previewUrl = null;
    video.assetUrl = "data:video/mp4;base64,";
    audio.assetUrl = "data:audio/mpeg;base64,";
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);

    try {
      render(<App />);
      expect(screen.getByLabelText("城市延时.mp4 视频缩略图")).toBeInstanceOf(HTMLVideoElement);
      await user.click(screen.getByRole("button", { name: "播放 背景音乐.mp3" }));
      expect(await screen.findByRole("button", { name: "暂停 背景音乐.mp3" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "暂停 背景音乐.mp3" }));
      expect(pause).toHaveBeenCalled();

      const audioCard = screen.getByText("背景音乐.mp3").closest(".asset-card")!;
      await user.dblClick(audioCard);
      const dialog = screen.getByRole("dialog", { name: "预览 背景音乐.mp3" });
      expect(dialog.querySelector("audio[controls]")).not.toBeNull();
      expect(dialog.querySelector(".media-play")).toBeNull();
    } finally {
      video.previewUrl = originalVideoPreview;
      video.assetUrl = originalVideoUrl;
      audio.assetUrl = originalAudioUrl;
      play.mockRestore();
      pause.mockRestore();
    }
  });

  it("batch edits folders and creates tags for every selected asset", async () => {
    const user = userEvent.setup();
    render(<App />);
    const cityCard = screen.getByText("城市延时.mp4").closest(".asset-card")!;
    fireEvent.click(cityCard, { ctrlKey: true });
    const inspector = document.querySelector(".inspector") as HTMLElement;
    await waitFor(() => expect(within(inspector).getByText("已选择 2 项")).toBeInTheDocument());

    const documentRow = screen.getAllByText("文档").find((element) => element.classList.contains("sidebar-label"))!.closest("button")!;
    expect(within(documentRow).getByText("1")).toBeInTheDocument();
    await user.click(within(inspector).getByRole("button", { name: "添加到文件夹" }));
    await user.click(within(inspector).getByRole("button", { name: "文档" }));
    await waitFor(() => expect(within(documentRow).getByText("3")).toBeInTheDocument());

    await user.click(within(inspector).getByRole("button", { name: "添加标签" }));
    await user.type(within(inspector).getByRole("textbox", { name: "新标签名称" }), "待审核");
    await user.click(within(inspector).getByRole("button", { name: "创建并添加" }));
    await waitFor(() => expect(within(inspector).getByRole("button", { name: "移除标签 待审核" })).toBeInTheDocument());
  });
});
