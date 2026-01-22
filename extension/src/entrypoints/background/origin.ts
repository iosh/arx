import type { Runtime } from "webextension-polyfill";
import browser from "webextension-polyfill";

export const getExtensionOrigin = () => browser.runtime.getURL("").replace(/\/$/, "");

export const isInternalOrigin = (origin: string, extensionOrigin: string) => origin === extensionOrigin;

export const getPortOrigin = (port: Runtime.Port, extensionOrigin: string): string => {
  const sender = port.sender;
  const sourceUrl = sender?.url ?? sender?.tab?.url;

  if (sourceUrl) {
    try {
      return new URL(sourceUrl).origin;
    } catch {
      // ignore parse failure
    }
  }

  if (sender?.id === browser.runtime.id) {
    return extensionOrigin;
  }

  return "unknown://";
};
