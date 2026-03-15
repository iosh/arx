import { describe, expect, it, vi } from "vitest";

const { bootstrapInpageProviderMock, createRegistryMock } = vi.hoisted(() => ({
  bootstrapInpageProviderMock: vi.fn(),
  createRegistryMock: vi.fn(),
}));

const registry = {
  byNamespace: new Map(),
  modules: [],
} as const;

vi.mock("@arx/provider/inpage", () => ({
  bootstrapInpageProvider: bootstrapInpageProviderMock,
}));

vi.mock("@/platform/namespaces/installed", () => ({
  INSTALLED_NAMESPACES: {
    provider: {
      createRegistry: createRegistryMock,
    },
  },
}));

vi.mock("wxt/utils/define-unlisted-script", () => ({
  defineUnlistedScript: (entrypoint: () => void) => entrypoint,
}));

describe("inpage entrypoint", () => {
  it("boots provider host from the installed namespace provider assembly", async () => {
    createRegistryMock.mockReturnValue(registry);

    const entrypoint = await import("./index");
    const runEntrypoint = entrypoint.default as unknown as () => void;
    runEntrypoint();

    expect(createRegistryMock).toHaveBeenCalledTimes(1);
    expect(bootstrapInpageProviderMock).toHaveBeenCalledWith({
      registry,
    });
  });
});
