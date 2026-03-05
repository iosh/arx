import type browserDefaultType from "webextension-polyfill";
import { createPopupActivator, type PopupOpenContext, type PopupOpenResult } from "../services/popupActivator";

export type OnboardingOpenResult = { activationPath: "focus" | "create" | "debounced"; tabId?: number };

export type UiPlatform = {
  openOnboardingTab: (reason: string) => Promise<OnboardingOpenResult>;
  openNotificationPopup: (ctx?: PopupOpenContext) => Promise<PopupOpenResult>;
  trackWindowClose: (windowId: number, onClose: () => void) => void;
  clearWindowCloseTracks: () => void;
  teardown: () => void;
};

type UiPlatformDeps = {
  browser: typeof browserDefaultType;
  entrypoints: { ONBOARDING: string; NOTIFICATION: string };
};

export const createUiPlatform = ({ browser, entrypoints }: UiPlatformDeps): UiPlatform => {
  const onboardingCooldownMs = 500;
  let lastOnboardingAttemptAt: number | null = null;
  let onboardingInFlight: Promise<OnboardingOpenResult> | null = null;
  let cachedOnboardingTabId: number | null = null;

  const openOnboardingTab = (_reason: string): Promise<OnboardingOpenResult> => {
    if (onboardingInFlight) return onboardingInFlight;

    const promise = (async (): Promise<OnboardingOpenResult> => {
      const now = Date.now();

      if (lastOnboardingAttemptAt !== null && now - lastOnboardingAttemptAt < onboardingCooldownMs) {
        return cachedOnboardingTabId
          ? { activationPath: "debounced" as const, tabId: cachedOnboardingTabId }
          : { activationPath: "debounced" as const };
      }
      lastOnboardingAttemptAt = now;

      const onboardingBaseUrl = browser.runtime.getURL(entrypoints.ONBOARDING);

      let existingTabs: browserDefaultType.Tabs.Tab[] = [];
      try {
        existingTabs = await browser.tabs.query({ url: [`${onboardingBaseUrl}*`] });
      } catch {
        const allTabs = await browser.tabs.query({});
        existingTabs = (allTabs ?? []).filter(
          (tab) => typeof tab.url === "string" && tab.url.startsWith(onboardingBaseUrl),
        );
      }

      const existing = existingTabs.find((tab) => typeof tab.id === "number");
      if (existing?.id) {
        cachedOnboardingTabId = existing.id;
        await browser.tabs.update(existing.id, { active: true });
        if (typeof existing.windowId === "number") {
          await browser.windows.update(existing.windowId, { focused: true });
        }
        return { activationPath: "focus" as const, tabId: existing.id };
      }

      const created = await browser.tabs.create({ url: onboardingBaseUrl, active: true });
      if (typeof created.windowId === "number") {
        await browser.windows.update(created.windowId, { focused: true });
      }
      cachedOnboardingTabId = typeof created.id === "number" ? created.id : null;
      return typeof created.id === "number"
        ? { activationPath: "create" as const, tabId: created.id }
        : { activationPath: "create" as const };
    })().finally(() => {
      onboardingInFlight = null;
    });

    onboardingInFlight = promise;
    return promise;
  };

  const notificationActivator = createPopupActivator({ browser, popupPath: entrypoints.NOTIFICATION });
  const openNotificationPopup = async (ctx?: PopupOpenContext): Promise<PopupOpenResult> => {
    return await notificationActivator.open(ctx);
  };

  const trackedWindows = new Map<number, (removedId: number) => void>();
  const trackWindowClose = (windowId: number, onClose: () => void) => {
    if (trackedWindows.has(windowId)) return;

    const onRemoved = (removedId: number) => {
      if (removedId !== windowId) return;
      browser.windows.onRemoved.removeListener(onRemoved);
      trackedWindows.delete(windowId);
      onClose();
    };

    trackedWindows.set(windowId, onRemoved);
    browser.windows.onRemoved.addListener(onRemoved);
  };

  const clearWindowCloseTracks = () => {
    for (const [_windowId, listener] of Array.from(trackedWindows.entries())) {
      browser.windows.onRemoved.removeListener(listener);
    }
    trackedWindows.clear();
  };

  const teardown = () => {
    clearWindowCloseTracks();
  };

  return { openOnboardingTab, openNotificationPopup, trackWindowClose, clearWindowCloseTracks, teardown };
};
