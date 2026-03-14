import { describe, expect, it } from "vitest";
import type { ProviderModule } from "./index.js";
import { createProviderRegistryFromModules } from "./index.js";

const createModule = (namespace: string): ProviderModule => ({
  namespace,
  create: () => {
    throw new Error("not implemented");
  },
});

describe("provider registry", () => {
  it("builds a registry from explicit modules", () => {
    const registry = createProviderRegistryFromModules([createModule("eip155"), createModule("conflux")]);

    expect(registry.modules.map((module) => module.namespace)).toEqual(["eip155", "conflux"]);
    expect([...registry.byNamespace.keys()]).toEqual(["eip155", "conflux"]);
  });

  it("rejects duplicate namespaces", () => {
    expect(() => createProviderRegistryFromModules([createModule("eip155"), createModule("eip155")])).toThrow(
      /Duplicate provider module namespace "eip155"/,
    );
  });
});
