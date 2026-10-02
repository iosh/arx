import browser from "webextension-polyfill";

const HEARTBEAT_INTERVAL_MS = 20_000;

export const startBackgroundHeartbeat = (): (() => void) => {
  const heartbeat = async () => {
    try {
      // Extension API calls reset the background idle timer without renewing wallet activity.
      await browser.runtime.getPlatformInfo();
    } catch {
      // Heartbeat failures are non-fatal; the next interval retries.
    }
  };

  void heartbeat();
  const interval = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(interval);
};
