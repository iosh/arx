/* @vitest-environment jsdom */
/* @vitest-environment-options {"url":"https://dapp.test"} */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderHost, ProviderHostWindow } from "../host/index.js";
import type { ProviderModule, ProviderRegistry } from "../registry/index.js";
import type { Transport } from "../types/index.js";

const { createProviderHostMock, hostInitializeMock } = vi.hoisted(() => ({
  createProviderHostMock: vi.fn(),
  hostInitializeMock: vi.fn(),
}));

vi.mock("../host/index.js", () => ({
  createProviderHost: createProviderHostMock,
}));

const HOST_KEY = Symbol.for("com.arx.wallet/inpageHost");
const BOOTSTRAP_STATE_KEY = Symbol.for("com.arx.wallet/inpageBootstrapState");

const clearBootstrapGlobals = () => {
  Reflect.deleteProperty(globalThis, HOST_KEY);
  Reflect.deleteProperty(globalThis, BOOTSTRAP_STATE_KEY);
};

const createRegistry = (...namespaces: string[]): ProviderRegistry => {
  const modules = namespaces.map(
    (namespace) =>
      ({
        namespace,
        create: () => {
          throw new Error("not used in test");
        },
      }) satisfies ProviderModule,
  );

  return {
    modules,
    byNamespace: new Map(modules.map((module) => [module.namespace, module])),
  };
};

describe("bootstrapInpageProvider", () => {
  beforeEach(() => {
    clearBootstrapGlobals();
    vi.clearAllMocks();
    createProviderHostMock.mockReturnValue({
      initialize: hostInitializeMock,
    } as unknown as ProviderHost);
  });

  afterEach(() => {
    clearBootstrapGlobals();
  });

  it("reuses the same host when called again with stable options", async () => {
    const { bootstrapInpageProvider } = await import("./index.js");
    const registry = createRegistry("eip155");
    const targetWindow = window as unknown as ProviderHostWindow;
    const createTransportForNamespace = vi.fn((namespace: string) => ({ namespace }) as unknown as Transport);

    const firstHost = bootstrapInpageProvider({
      registry,
      exposedNamespaces: ["eip155"],
      targetWindow,
      createTransportForNamespace,
    });
    const secondHost = bootstrapInpageProvider({
      registry,
      exposedNamespaces: ["eip155"],
      targetWindow,
      createTransportForNamespace,
    });

    expect(firstHost).toBe(secondHost);
    expect(createProviderHostMock).toHaveBeenCalledTimes(1);
    expect(hostInitializeMock).toHaveBeenCalledTimes(2);
  });

  it("rejects exposed namespaces that do not match the registry modules", async () => {
    const { bootstrapInpageProvider } = await import("./index.js");

    expect(() =>
      bootstrapInpageProvider({
        registry: createRegistry("eip155"),
        exposedNamespaces: ["conflux"],
        targetWindow: window as unknown as ProviderHostWindow,
        createTransportForNamespace: vi.fn(() => ({}) as unknown as Transport),
      }),
    ).toThrow(/expected exposed namespaces \[conflux\] to match registry modules \[eip155\]/);

    expect(createProviderHostMock).not.toHaveBeenCalled();
  });

  it("rejects repeated bootstrap calls that change the registry", async () => {
    const { bootstrapInpageProvider } = await import("./index.js");
    const targetWindow = window as unknown as ProviderHostWindow;
    const createTransportForNamespace = vi.fn(() => ({}) as unknown as Transport);

    bootstrapInpageProvider({
      registry: createRegistry("eip155"),
      exposedNamespaces: ["eip155"],
      targetWindow,
      createTransportForNamespace,
    });

    expect(() =>
      bootstrapInpageProvider({
        registry: createRegistry("eip155"),
        exposedNamespaces: ["eip155"],
        targetWindow,
        createTransportForNamespace,
      }),
    ).toThrow(/stable options; changed registry/);
  });
});
