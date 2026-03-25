import { describe, expect, it, vi } from "vitest";

const { bootstrapInpageProviderMock } = vi.hoisted(() => ({
  bootstrapInpageProviderMock: vi.fn(),
}));

const registry = {
  byNamespace: new Map(),
  modules: [],
} as const;
const exposedNamespaces = ["eip155"] as const;

vi.mock("@arx/provider/inpage", () => ({
  bootstrapInpageProvider: bootstrapInpageProviderMock,
}));

vi.mock("@/platform/namespaces/installed", () => ({
  INSTALLED_NAMESPACES: {
    provider: {
      exposedNamespaces,
      registry,
    },
  },
}));

vi.mock("wxt/utils/define-unlisted-script", () => ({
  defineUnlistedScript: (entrypoint: () => void) => entrypoint,
}));

describe("inpage entrypoint", () => {
  it("boots provider host from the installed namespace provider assembly", async () => {
    const entrypoint = await import("./index");
    const runEntrypoint = entrypoint.default as unknown as () => void;
    runEntrypoint();

    expect(bootstrapInpageProviderMock).toHaveBeenCalledWith({
      exposedNamespaces,
      registry,
    });
  });
});
