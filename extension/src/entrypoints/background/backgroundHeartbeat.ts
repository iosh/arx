import browser from "webextension-polyfill";

const HEARTBEAT_INTERVAL_MS = 20_000;

export const startBackgroundHeartbeat = (): (() => void) => {
  const heartbeat = () => {
    // Extension API calls reset the background idle timer without renewing wallet activity.
    void browser.runtime.getPlatformInfo();
  };

  heartbeat();
  const interval = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(interval);
};
