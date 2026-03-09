import type { ProviderHost, ProviderHostFeatures, ProviderHostWindow } from "../host/index.js";
import { createProviderHost } from "../host/index.js";
import type { ProviderRegistry } from "../registry/index.js";
import { WindowPostMessageTransport } from "../transport/index.js";
import type { Transport } from "../types/index.js";

export type BootstrapInpageProviderOptions = {
  targetWindow?: ProviderHostWindow;
  createTransportForNamespace?: (namespace: string) => Transport;
  registry?: ProviderRegistry;
  features?: ProviderHostFeatures;
  logger?: Readonly<{ debug?: (message: string, meta?: unknown) => void }>;
};

const HOST_KEY = Symbol.for("com.arx.wallet/inpageHost");

export const bootstrapInpageProvider = (options: BootstrapInpageProviderOptions = {}): ProviderHost => {
  type GlobalWithHost = typeof globalThis & { [HOST_KEY]?: ProviderHost };
  const g = globalThis as GlobalWithHost;

  let host = g[HOST_KEY];
  if (!host) {
    const targetWindow = options.targetWindow ?? (window as unknown as ProviderHostWindow);

    host = createProviderHost({
      targetWindow,
      createTransportForNamespace:
        options.createTransportForNamespace ?? ((namespace: string) => new WindowPostMessageTransport({ namespace })),
      ...(options.registry ? { registry: options.registry } : {}),
      ...(options.features ? { features: options.features } : {}),
      ...(options.logger ? { logger: options.logger } : {}),
    });

    Object.defineProperty(g, HOST_KEY, {
      configurable: true,
      enumerable: false,
      value: host,
      writable: false,
    });
  }

  host.initialize();
  return host;
};
