import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { AppHeader } from "./AppHeader";

const library = {
  id: "library",
  name: "测试资源库",
  path: "/tmp/test.libr",
  schemaVersion: 1,
  readOnly: false,
  assetCount: 0,
  recentCount: 0,
  unfiledCount: 0,
  favoriteCount: 0,
  duplicateCount: 0,
  trashCount: 0,
  totalBytes: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const createProps = () => ({
  library,
  searchText: "",
  sortBy: "importedAt" as const,
  viewMode: "grid" as const,
  deleteOriginals: false,
  onSearch: vi.fn(),
  onImportFiles: vi.fn(),
  onImportFolder: vi.fn(),
  onImportSettings: vi.fn(),
  onSort: vi.fn(),
  onViewMode: vi.fn(),
  onToggleFilters: vi.fn(),
  onToggleSidebar: vi.fn(),
  onLibraryMenu: vi.fn(),
  onAppMenu: vi.fn(),
  libraryMenuOpen: false,
  appMenuOpen: false,
  libraryMenuTriggerRef: { current: null },
  appMenuTriggerRef: { current: null },
});

describe("AppHeader import settings", () => {
  it("opens a separate configuration window from the import menu", async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<AppHeader {...props} />);

    await user.click(screen.getByRole("button", { name: "显示导入选项" }));
    const menu = screen.getByRole("menu", { name: "导入选项" });
    expect(within(menu).queryByRole("menuitemcheckbox")).not.toBeInTheDocument();
    expect(within(menu).getByText("当前：保留原文件")).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: /导入配置/ }));

    expect(props.onImportSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu", { name: "导入选项" })).not.toBeInTheDocument();
  });
});
