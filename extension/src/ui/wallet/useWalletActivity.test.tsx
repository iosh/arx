// @vitest-environment jsdom

import { WalletChannelDisconnectedError, type WalletClient } from "@arx/wallet-api/client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWalletActivity } from "./useWalletActivity";

function Activity({ wallet }: { wallet: ReturnType<typeof createWallet> }) {
  useWalletActivity(wallet as unknown as WalletClient);
  return null;
}

const createWallet = () => ({
  getStatus: vi.fn<WalletClient["getStatus"]>().mockResolvedValue("locked"),
  notifyUserActivity: vi.fn<WalletClient["notifyUserActivity"]>().mockResolvedValue(undefined),
  subscribe: vi.fn<WalletClient["subscribe"]>(() => vi.fn()),
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

  await act(() => root.render(<Activity wallet={wallet} />));
  expect(added.mock.calls.some(([type]) => type === "pointerdown")).toBe(false);
  wallet.subscribe.mock.calls[0]?.[0]({ type: "walletStatusChanged", status: "unlocked" });
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

  wallet.subscribe.mock.calls[0]?.[0]({ type: "walletStatusChanged", status: "locked" });
  expect(removed).toHaveBeenCalledWith("pointerdown", input, expect.objectContaining({ capture: true }));
});

it("does not enable input when an older initial read arrives after a lock event", async () => {
  const wallet = createWallet();
  const initialStatus = Promise.withResolvers<Awaited<ReturnType<WalletClient["getStatus"]>>>();
  wallet.getStatus.mockReturnValue(initialStatus.promise);
  const added = vi.spyOn(document, "addEventListener");

  await act(() => root.render(<Activity wallet={wallet} />));
  await act(() => {
    wallet.subscribe.mock.calls[0]?.[0]({ type: "walletStatusChanged", status: "locked" });
    initialStatus.resolve("unlocked");
  });

  expect(added.mock.calls.some(([type]) => type === "pointerdown")).toBe(false);
  expect(wallet.notifyUserActivity).not.toHaveBeenCalled();
});

it("stops on a disconnected activity call without treating a single send failure as disconnection", async () => {
  const wallet = createWallet();
  wallet.getStatus.mockResolvedValue("unlocked");
  const added = vi.spyOn(document, "addEventListener");
  const removed = vi.spyOn(document, "removeEventListener");
  const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);

  await act(() => root.render(<Activity wallet={wallet} />));
  const input = added.mock.calls.find(([type]) => type === "pointerdown")?.[1] as EventListener;
  const unsubscribe = wallet.subscribe.mock.results[0]?.value;
  wallet.notifyUserActivity.mockRejectedValueOnce(new Error("postMessage failed"));
  await act(() => input({ isTrusted: true } as Event));
  expect(diagnostic).toHaveBeenCalledOnce();
  expect(unsubscribe).not.toHaveBeenCalled();

  now = 1_000;
  wallet.notifyUserActivity.mockRejectedValueOnce(new WalletChannelDisconnectedError());
  await act(() => input({ isTrusted: true } as Event));
  expect(wallet.notifyUserActivity).toHaveBeenCalledTimes(2);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(removed).toHaveBeenCalledWith("pointerdown", input, expect.objectContaining({ capture: true }));
});
