import { describe, expect, it } from "vitest";
import { createProviderRegistry } from "../registry/index.js";
import {
  BUILTIN_PROVIDER_MODULE_FACTORIES,
  BUILTIN_PROVIDER_MODULES,
  createBuiltinProviderModules,
} from "./builtin.js";

describe("builtin provider modules", () => {
  it("exposes eip155 as the current builtin provider module", () => {
    expect(BUILTIN_PROVIDER_MODULE_FACTORIES.map((factory) => factory.namespace)).toEqual(["eip155"]);
    expect(BUILTIN_PROVIDER_MODULES.map((module) => module.namespace)).toEqual(["eip155"]);

    const [module] = BUILTIN_PROVIDER_MODULES;
    expect(module?.injection).toMatchObject({
      windowKey: "ethereum",
      mode: "if_absent",
      initializedEvent: "ethereum#initialized",
    });
    expect(module?.discovery?.eip6963?.info?.name).toBe("ARX Wallet");
  });

  it("builds registries from the builtin provider module list", () => {
    const modules = createBuiltinProviderModules();
    const registry = createProviderRegistry();

    expect(registry.modules.map((module) => module.namespace)).toEqual(modules.map((module) => module.namespace));
    expect([...registry.byNamespace.keys()]).toEqual(["eip155"]);
    expect(registry.byNamespace.get("eip155")).toEqual(registry.modules[0]);
  });
});
