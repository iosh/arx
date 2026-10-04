// @vitest-environment jsdom

import type { WalletClient } from "@arx/wallet-api/client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWalletActivity } from "./useWalletActivity";

function Activity({ wallet, unlocked }: { wallet: ReturnType<typeof createWallet>; unlocked: boolean }) {
  useWalletActivity(wallet as unknown as WalletClient, unlocked);
  return null;
}

const createWallet = () => ({
  notifyUserActivity: vi.fn<WalletClient["notifyUserActivity"]>().mockResolvedValue(undefined),
});

let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reports visible trusted input with leading throttling only while unlocked", async () => {
  const wallet = createWallet();
  const added = vi.spyOn(document, "addEventListener");
  const removed = vi.spyOn(document, "removeEventListener");
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);

  await act(() => root.render(<Activity wallet={wallet} unlocked={false} />));
  expect(added.mock.calls.some(([type]) => type === "pointerdown")).toBe(false);
  await act(() => root.render(<Activity wallet={wallet} unlocked />));
  expect(wallet.notifyUserActivity).not.toHaveBeenCalled();

  const input = added.mock.calls.find(([type]) => type === "pointerdown")?.[1] as EventListener;
  input({ isTrusted: false } as Event);
  visibility.mockReturnValue("hidden");
  input({ isTrusted: true } as Event);
  expect(wallet.notifyUserActivity).not.toHaveBeenCalled();

  visibility.mockReturnValue("visible");
  input({ isTrusted: true } as Event);
  now = 999;
  input({ isTrusted: true } as Event);
  expect(wallet.notifyUserActivity).toHaveBeenCalledOnce();
  now = 1_000;
  input({ isTrusted: true } as Event);
  expect(wallet.notifyUserActivity).toHaveBeenCalledTimes(2);

  await act(() => root.render(<Activity wallet={wallet} unlocked={false} />));
  expect(removed).toHaveBeenCalledWith("pointerdown", input, expect.objectContaining({ capture: true }));
});
