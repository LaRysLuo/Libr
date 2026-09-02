import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ImportSettingsDialog } from "./ImportSettingsDialog";

describe("ImportSettingsDialog", () => {
  it("saves cut mode only after an explicit selection", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ImportSettingsDialog settings={{ mode: "map" }} onCancel={vi.fn()} onSave={onSave} />);

    await user.click(screen.getByRole("radio", { name: /删除原文件/ }));
    expect(screen.getByText(/无法在 Libr 中撤销/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    expect(onSave).toHaveBeenCalledWith({ mode: "move" });
  });

  it("offers mapped import as the space-saving default", () => {
    render(<ImportSettingsDialog settings={{ mode: "map" }} onCancel={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /映射原文件/ })).toBeChecked();
    expect(screen.getByText(/请勿移动或删除原文件/)).toBeInTheDocument();
  });
});
