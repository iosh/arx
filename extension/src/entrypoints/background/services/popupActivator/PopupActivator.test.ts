import { describe, expect, it, vi } from "vitest";
import { createPopupActivator } from "./PopupActivator.js";

type PopupActivatorDeps = NonNullable<Parameters<typeof createPopupActivator>[0]>;

const makeBrowser = () => {
  const runtime = { getURL: vi.fn((p: string) => `ext://${p}`) };
  const windows = { get: vi.fn(), update: vi.fn(), getAll: vi.fn(), create: vi.fn() };
  return { runtime, windows };
};

describe("PopupActivator", () => {
  it("uses custom popupPath for notification window", async () => {
    const browser = makeBrowser();
    browser.windows.getAll.mockResolvedValue([]);
    browser.windows.create.mockResolvedValue({ id: 1 });

    const act = createPopupActivator({
      browser: browser as unknown as PopupActivatorDeps["browser"],
      now: () => 0,
      popupPath: "notification.html",
    });
    await expect(act.open()).resolves.toMatchObject({ activationPath: "create", windowId: 1 });

    expect(browser.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "ext://notification.html",
      }),
    );
  });
  it("creates popup when missing", async () => {
    const browser = makeBrowser();
    browser.windows.getAll.mockResolvedValue([]);
    browser.windows.create.mockResolvedValue({ id: 1 });
    const act = createPopupActivator({ browser: browser as unknown as PopupActivatorDeps["browser"], now: () => 0 });
    await expect(act.open()).resolves.toMatchObject({ activationPath: "create", windowId: 1 });
    expect(browser.windows.create).toHaveBeenCalledTimes(1);
  });

  it("scans and focuses when cached window is gone", async () => {
    const browser = makeBrowser();
    const popupUrl = browser.runtime.getURL("popup.html");
    let t = 0;
    browser.windows.getAll.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 9, tabs: [{ url: popupUrl }] }]);
    browser.windows.create.mockResolvedValue({ id: 1 });
    browser.windows.get.mockRejectedValueOnce(new Error("gone")).mockResolvedValue({});
    const act = createPopupActivator({ browser: browser as unknown as PopupActivatorDeps["browser"], now: () => t });
    await act.open(); // create id=1, caches it
    t = 1000;
    await expect(act.open()).resolves.toMatchObject({ activationPath: "focus", windowId: 9 });
    expect(browser.windows.update).toHaveBeenCalledWith(9, { focused: true });
    expect(browser.windows.create).toHaveBeenCalledTimes(1);
  });

  it("debounces within cooldown window", async () => {
    const browser = makeBrowser();
    let t = 0;
    browser.windows.getAll.mockResolvedValue([]);
    browser.windows.create.mockResolvedValue({ id: 2 });
    const act = createPopupActivator({
      browser: browser as unknown as PopupActivatorDeps["browser"],
      now: () => t,
      cooldownMs: 500,
    });
    await act.open();
    t = 100;
    await expect(act.open()).resolves.toMatchObject({ activationPath: "debounced", debounced: true });
    expect(browser.windows.create).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent opens (inFlight)", async () => {
    const browser = makeBrowser();
    browser.windows.getAll.mockResolvedValue([]);

    let fulfillCreate: ((value: { id: number }) => void) | undefined;
    browser.windows.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          fulfillCreate = resolve;
        }),
    );

    const act = createPopupActivator({ browser: browser as unknown as PopupActivatorDeps["browser"], now: () => 0 });
    const p1 = act.open();
    const p2 = act.open();

    await vi.waitFor(() => expect(browser.windows.create).toHaveBeenCalledTimes(1));
    fulfillCreate?.({ id: 3 });
    await Promise.all([p1, p2]);
  });
});
