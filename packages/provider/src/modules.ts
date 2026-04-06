import type { Transport } from "./types/transport.js";

export type Eip6963Info = Readonly<{
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}>;

export type ProviderModuleInstance<TCore = unknown, TInjected extends object = object> = Readonly<{
  core: TCore;
  injected: TInjected;
}>;

export type ProviderInjection = Readonly<{
  // Property on Window to inject into (e.g. "ethereum", "conflux").
  windowKey: string;
  // do not override another wallet.
  mode?: "if_absent" | "never";
  // If set, fire this event when injection succeeds.
  initializedEvent?: string;
}>;

export type ProviderDiscovery = Readonly<{
  // EIP-6963 multi-provider discovery.
  eip6963?: Readonly<{ info: Eip6963Info }>;
}>;

export type ProviderModule<
  TCore = unknown,
  TInjected extends object = object,
  TSnapshot = unknown,
  TPatch = unknown,
> = Readonly<{
  namespace: string;
  create(ctx: { transport: Transport<TSnapshot, TPatch> }): ProviderModuleInstance<TCore, TInjected>;
  injection?: ProviderInjection;
  discovery?: ProviderDiscovery;
}>;
