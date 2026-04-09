import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearUiEntryMetadataCache,
  createUiEntryMetadata,
  getUiEntryMetadata,
  getUiEnvironment,
  hydrateUiEntryMetadata,
  parseUiEntryReason,
  parseUiEnvironment,
  subscribeUiEntryMetadata,
} from "./uiEntryMetadata";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

const installDom = (input: { environmentMeta: string }) => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href: "https://wallet.test/notification.html",
      },
    },
  });

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      querySelector: (selector: string) => {
        if (selector === 'meta[name="arx:uiEnvironment"]') {
          return {
            getAttribute: (name: string) => (name === "content" ? input.environmentMeta : null),
          };
        }

        return null;
      },
    },
  });
};

describe("uiEntryMetadata", () => {
  afterEach(() => {
    clearUiEntryMetadataCache();

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
  });

  it("parses known environments and reasons", () => {
    expect(parseUiEnvironment("popup")).toBe("popup");
    expect(parseUiEnvironment("bad")).toBeNull();
    expect(parseUiEntryReason("approval_created")).toBe("approval_created");
    expect(parseUiEntryReason("bad")).toBeNull();
  });

  it("reads the environment from meta tags", () => {
    installDom({
      environmentMeta: "notification",
    });

    expect(getUiEnvironment()).toBe("notification");
  });

  it("hydrates and reads runtime-owned entry metadata", () => {
    expect(
      hydrateUiEntryMetadata(
        createUiEntryMetadata({
          environment: "notification",
          reason: "approval_created",
          context: { approvalId: "approval-1" },
        }),
      ),
    ).toEqual({
      environment: "notification",
      reason: "approval_created",
      context: {
        approvalId: "approval-1",
        origin: null,
        method: null,
        chainRef: null,
        namespace: null,
      },
    });

    expect(getUiEntryMetadata()).toEqual({
      environment: "notification",
      reason: "approval_created",
      context: {
        approvalId: "approval-1",
        origin: null,
        method: null,
        chainRef: null,
        namespace: null,
      },
    });
  });

  it("notifies subscribers when metadata changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUiEntryMetadata(listener);

    hydrateUiEntryMetadata(
      createUiEntryMetadata({
        environment: "notification",
        reason: "manual_open",
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
