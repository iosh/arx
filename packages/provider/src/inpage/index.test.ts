/* @vitest-environment jsdom */
/* @vitest-environment-options {"url":"https://dapp.test"} */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderHost, ProviderHostWindow } from "../host/index.js";
import type { ProviderModule } from "../modules.js";
import type { Transport } from "../types/index.js";

const { createProviderHostMock, hostInitializeMock, hostDestroyMock } = vi.hoisted(() => ({
  createProviderHostMock: vi.fn(),
  hostInitializeMock: vi.fn(),
  hostDestroyMock: vi.fn(),
}));

vi.mock("../host/index.js", () => ({
  createProviderHost: createProviderHostMock,
}));

const BOOTSTRAP_STATE_KEY = Symbol.for("com.arx.wallet/inpageBootstrapState");

const clearBootstrapGlobals = () => {
  Reflect.deleteProperty(globalThis, BOOTSTRAP_STATE_KEY);
};

const createModules = (...namespaces: string[]): readonly ProviderModule[] => {
  return namespaces.map(
    (namespace) =>
      ({
        namespace,
        create: () => {
          throw new Error("not used in test");
        },
      }) satisfies ProviderModule,
  );
};

describe("bootstrapInpageProvider", () => {
  beforeEach(() => {
    clearBootstrapGlobals();
    vi.clearAllMocks();
    createProviderHostMock.mockImplementation(
      () =>
        ({
          initialize: hostInitializeMock,
          destroy: hostDestroyMock,
        }) as unknown as ProviderHost,
    );
  });

  afterEach(() => {
    clearBootstrapGlobals();
  });

  it("reuses the same host when called again with stable options", async () => {
    const { bootstrapInpageProvider } = await import("./index.js");
    const modules = createModules("eip155");
    const targetWindow = window as unknown as ProviderHostWindow;
    const createTransportForNamespace = vi.fn((namespace: string) => ({ namespace }) as unknown as Transport);

    const firstHost = bootstrapInpageProvider({
      modules,
      targetWindow,
      createTransportForNamespace,
    });
    const secondHost = bootstrapInpageProvider({
      modules,
      targetWindow,
      createTransportForNamespace,
    });

    expect(firstHost).toBe(secondHost);
    expect(createProviderHostMock).toHaveBeenCalledTimes(1);
    expect(hostInitializeMock).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown prewarm namespaces", async () => {
    const { bootstrapInpageProvider } = await import("./index.js");

    expect(() =>
      bootstrapInpageProvider({
        modules: createModules("eip155"),
        prewarmNamespaces: ["conflux"],
        targetWindow: window as unknown as ProviderHostWindow,
        createTransportForNamespace: vi.fn(() => ({}) as unknown as Transport),
      }),
    ).toThrow(/received prewarmNamespaces entry "conflux" that is not installed; expected one of \[eip155\]/);

    expect(createProviderHostMock).not.toHaveBeenCalled();
  });

  it("rejects repeated bootstrap calls that change the modules", async () => {
    const { bootstrapInpageProvider } = await import("./index.js");
    const targetWindow = window as unknown as ProviderHostWindow;
    const createTransportForNamespace = vi.fn(() => ({}) as unknown as Transport);

    bootstrapInpageProvider({
      modules: createModules("eip155"),
      targetWindow,
      createTransportForNamespace,
    });

    expect(() =>
      bootstrapInpageProvider({
        modules: createModules("eip155"),
        targetWindow,
        createTransportForNamespace,
      }),
    ).toThrow(/stable options; changed modules/);
  });

  it("rejects empty prewarm namespace entries", async () => {
    const { bootstrapInpageProvider } = await import("./index.js");

    expect(() =>
      bootstrapInpageProvider({
        modules: createModules("eip155"),
        prewarmNamespaces: [" "],
        targetWindow: window as unknown as ProviderHostWindow,
        createTransportForNamespace: vi.fn(() => ({}) as unknown as Transport),
      }),
    ).toThrow(/requires non-empty entries in prewarmNamespaces/);
  });

  it("clears the singleton state when the host is destroyed", async () => {
    const { bootstrapInpageProvider } = await import("./index.js");
    const modules = createModules("eip155");
    const targetWindow = window as unknown as ProviderHostWindow;
    const createTransportForNamespace = vi.fn(() => ({}) as unknown as Transport);

    const firstHost = bootstrapInpageProvider({
      modules,
      targetWindow,
      createTransportForNamespace,
    });
    firstHost.destroy();

    const secondHost = bootstrapInpageProvider({
      modules,
      targetWindow,
      createTransportForNamespace,
    });

    expect(createProviderHostMock).toHaveBeenCalledTimes(2);
    expect(secondHost).not.toBe(firstHost);
    expect(hostDestroyMock).toHaveBeenCalledTimes(1);
  });
});
