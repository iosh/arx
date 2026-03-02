import type { EIP1193Provider } from "../types/eip1193.js";
import type { Transport } from "../types/transport.js";

export type Eip6963Info = Readonly<{
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}>;

export type ProviderEntry = Readonly<{
  // "raw" provider instance (not safe to expose to dapps).
  raw: EIP1193Provider;
  // Hardened dapp-facing surface (e.g. Proxy with read-only shims).
  injected: EIP1193Provider;
  destroy?: () => void;
}>;

export type ProviderInjection = Readonly<{
  // Property on Window to inject into (e.g. "ethereum", "conflux").
  windowKey: string;
  // Best practice: do not override another wallet.
  mode?: "if_absent" | "never";
  // If set, fire this event when injection succeeds.
  initializedEvent?: string;
}>;

export type ProviderDiscovery = Readonly<{
  // EIP-6963 multi-provider discovery.
  eip6963?: Readonly<{ info: Eip6963Info }>;
}>;

export type ProviderModule = Readonly<{
  namespace: string;
  create: (ctx: { transport: Transport }) => ProviderEntry;
  injection?: ProviderInjection;
  discovery?: ProviderDiscovery;
}>;

export type ProviderRegistry = Readonly<{
  modules: ReadonlyArray<ProviderModule>;
  byNamespace: ReadonlyMap<string, ProviderModule>;
}>;
