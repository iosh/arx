import { afterEach, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { WALLET_UI_INPUT_MESSAGE } from "@/transport/walletUiInput";
import { reportUserActivity } from "./reportUserActivity";

afterEach(() => vi.useRealTimers());

it("reports only trusted input, throttles it, and releases listeners on disconnect", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const port = {
    postMessage: vi.fn(),
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
  };
  const input = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  reportUserActivity(port as unknown as Runtime.Port, input as unknown as EventTarget);
  const handleInput = input.addEventListener.mock.calls[0]?.[1] as (event: Event) => void;

  handleInput({ isTrusted: false } as Event);
  expect(port.postMessage).not.toHaveBeenCalled();
  handleInput({ isTrusted: true } as Event);
  vi.setSystemTime(9_999);
  handleInput({ isTrusted: true } as Event);
  expect(port.postMessage).toHaveBeenCalledOnce();
  vi.setSystemTime(10_000);
  handleInput({ isTrusted: true } as Event);
  expect(port.postMessage.mock.calls).toEqual([[WALLET_UI_INPUT_MESSAGE], [WALLET_UI_INPUT_MESSAGE]]);

  port.onDisconnect.addListener.mock.calls[0]?.[0]();
  expect(input.removeEventListener.mock.calls).toEqual(input.addEventListener.mock.calls);
});
