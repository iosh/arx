import { describe, expect, it } from "vitest";
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
    expect(module?.discovery).toBeUndefined();
  });

  it("builds the builtin provider module list", () => {
    const modules = createBuiltinProviderModules();
    expect(modules.map((module) => module.namespace)).toEqual(["eip155"]);
  });

  it("lets callers opt into discovery metadata during assembly", () => {
    const [module] = createBuiltinProviderModules({
      eip155: {
        discovery: {
          eip6963: {
            info: {
              uuid: "90ef60ca-8ea5-4638-b577-6990dc93ef2f",
              name: "ARX Wallet",
              icon: "data:image/svg+xml;base64,PHN2Zy8+",
              rdns: "com.arx.wallet",
            },
          },
        },
      },
    });

    expect(module?.discovery?.eip6963?.info).toMatchObject({
      name: "ARX Wallet",
      rdns: "com.arx.wallet",
    });
  });
});
