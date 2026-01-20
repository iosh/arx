import { createLogger } from "@arx/core";
import type browserDefault from "webextension-polyfill";
import { ARX_UI_INNER_SIZE } from "@/ui/lib/uiWindow";

export type PopupOpenContext = {
  reason?: string;
  origin?: string;
  method?: string;
  chainRef?: string | null;
  namespace?: string | null;
};

export type PopupOpenResult = { activationPath: "create" | "focus" | "debounced" } & (
  | { windowId: number; debounced?: boolean }
  | { windowId?: never; debounced?: boolean }
);

type PopupActivatorDeps = {
  browser?: typeof browserDefault;
  now?: () => number;
  cooldownMs?: number;
  popupPath?: string;
  size?: { width: number; height: number };
};

export const createPopupActivator = (deps: PopupActivatorDeps = {}) => {
  let resolvedBrowser: typeof browserDefault | null = deps.browser ?? null;
  const getBrowser = async (): Promise<typeof browserDefault> => {
    if (resolvedBrowser) return resolvedBrowser;
    const mod = await import("webextension-polyfill");
    resolvedBrowser = (mod.default ?? mod) as typeof browserDefault;
    return resolvedBrowser;
  };

  const log = createLogger("bg:popup");
  const now = deps.now ?? (() => Date.now());
  const cooldownMs = deps.cooldownMs ?? 500;
  const popupPath = deps.popupPath ?? "popup.html";
  const size = deps.size ?? ARX_UI_INNER_SIZE;

  let cachedWindowId: number | null = null;
  let lastAttemptAt: number | null = null;
  let inFlight: Promise<PopupOpenResult> | null = null;
  const open = (ctx: PopupOpenContext = {}): Promise<PopupOpenResult> => {
    // Coalesce concurrent calls - only one execution in flight.
    if (inFlight) return inFlight;

    inFlight = (async (): Promise<PopupOpenResult> => {
      const browser = await getBrowser();
      const ts = now();

      // Debounce rapid calls within cooldown window.
      if (lastAttemptAt !== null && ts - lastAttemptAt < cooldownMs) {
        log("open debounced", { cooldownMs, ...ctx });
        return cachedWindowId === null
          ? { activationPath: "debounced", debounced: true }
          : { activationPath: "debounced", windowId: cachedWindowId, debounced: true };
      }
      lastAttemptAt = ts;
      const focusWindow = async (windowId: number): Promise<boolean> => {
        try {
          await browser.windows.get(windowId);
          await browser.windows.update(windowId, { focused: true });
          return true;
        } catch {
          return false;
        }
      };

      const popupUrl = browser.runtime.getURL(popupPath);

      if (cachedWindowId !== null && (await focusWindow(cachedWindowId))) {
        log("open focused (cached)", { windowId: cachedWindowId, ...ctx });
        return { activationPath: "focus", windowId: cachedWindowId };
      }

      // Fallback: scan popup windows for matching popup.html tab URL.
      try {
        const windows = await browser.windows.getAll({
          populate: true,
          windowTypes: ["popup"],
        });
        for (const win of windows ?? []) {
          if (win?.tabs?.some((tab) => tab?.url === popupUrl) && win?.id) {
            cachedWindowId = win.id;
            await browser.windows.update(win.id, { focused: true });
            log("open focused (scanned)", { windowId: win.id, ...ctx });
            return { activationPath: "focus", windowId: win.id };
          }
        }
      } catch {}

      const created = await browser.windows.create({
        type: "popup",
        focused: true,
        url: popupUrl,
        width: size.width,
        height: size.height,
      });

      cachedWindowId = created?.id ?? null;
      log("open created", { windowId: created?.id, size, ...ctx });
      return created?.id ? { activationPath: "create", windowId: created.id } : { activationPath: "create" };
    })().finally(() => {
      inFlight = null;
    });

    return inFlight;
  };

  return { open };
};
