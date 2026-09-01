import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ImportSettingsDialog } from "./ImportSettingsDialog";

describe("ImportSettingsDialog", () => {
  it("saves cut mode only after an explicit selection", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ImportSettingsDialog settings={{ deleteOriginals: false }} onCancel={vi.fn()} onSave={onSave} />);

    await user.click(screen.getByRole("radio", { name: /删除原文件/ }));
    expect(screen.getByText(/无法在 Libr 中撤销/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    expect(onSave).toHaveBeenCalledWith({ deleteOriginals: true });
  });
});
