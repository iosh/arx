import type { ProviderHost, ProviderHostFeatures, ProviderHostWindow } from "../host/index.js";
import { createProviderHost } from "../host/index.js";
import type { ProviderRegistry } from "../registry/index.js";
import { WindowPostMessageTransport } from "../transport/index.js";
import type { Transport } from "../types/index.js";

export type BootstrapInpageProviderOptions = {
  registry: ProviderRegistry;
  exposedNamespaces?: readonly string[];
  targetWindow?: ProviderHostWindow;
  createTransportForNamespace?: (namespace: string) => Transport;
  features?: ProviderHostFeatures;
  logger?: Readonly<{ debug?: (message: string, meta?: unknown) => void }>;
};

const HOST_KEY = Symbol.for("com.arx.wallet/inpageHost");
const BOOTSTRAP_STATE_KEY = Symbol.for("com.arx.wallet/inpageBootstrapState");

type InpageBootstrapState = Readonly<{
  host: ProviderHost;
  registry: ProviderRegistry;
  exposedNamespaces: readonly string[];
  targetWindow: ProviderHostWindow;
  createTransportForNamespace: (namespace: string) => Transport;
  eip6963: boolean;
}>;

const DEFAULT_CREATE_TRANSPORT_FOR_NAMESPACE = (namespace: string) => new WindowPostMessageTransport({ namespace });

const normalizeExposedNamespaces = (namespaces: readonly string[]) => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const namespace of namespaces) {
    const resolvedNamespace = namespace.trim();
    if (!resolvedNamespace) {
      throw new Error("bootstrapInpageProvider requires non-empty exposed namespaces");
    }
    if (seen.has(resolvedNamespace)) {
      throw new Error(`bootstrapInpageProvider received duplicate exposed namespace "${resolvedNamespace}"`);
    }

    seen.add(resolvedNamespace);
    normalized.push(resolvedNamespace);
  }

  return normalized;
};

const sameNamespaces = (left: readonly string[], right: readonly string[]) => {
  return left.length === right.length && left.every((namespace, index) => namespace === right[index]);
};

const assertExposedNamespacesMatchRegistry = (registry: ProviderRegistry, exposedNamespaces: readonly string[]) => {
  const registryNamespaces = registry.modules.map((module) => module.namespace);
  if (sameNamespaces(registryNamespaces, exposedNamespaces)) {
    return;
  }

  throw new Error(
    `bootstrapInpageProvider expected exposed namespaces [${exposedNamespaces.join(", ")}] to match registry modules [${registryNamespaces.join(", ")}]`,
  );
};

const assertStableBootstrapState = (current: InpageBootstrapState, next: Omit<InpageBootstrapState, "host">) => {
  const changedFields: string[] = [];

  if (current.registry !== next.registry) {
    changedFields.push("registry");
  }
  if (!sameNamespaces(current.exposedNamespaces, next.exposedNamespaces)) {
    changedFields.push("exposedNamespaces");
  }
  if (current.targetWindow !== next.targetWindow) {
    changedFields.push("targetWindow");
  }
  if (current.createTransportForNamespace !== next.createTransportForNamespace) {
    changedFields.push("createTransportForNamespace");
  }
  if (current.eip6963 !== next.eip6963) {
    changedFields.push("features.eip6963");
  }

  if (changedFields.length === 0) {
    return;
  }

  throw new Error(`bootstrapInpageProvider must be called with stable options; changed ${changedFields.join(", ")}`);
};

export const bootstrapInpageProvider = (options: BootstrapInpageProviderOptions): ProviderHost => {
  type GlobalWithBootstrap = typeof globalThis & {
    [HOST_KEY]?: ProviderHost;
    [BOOTSTRAP_STATE_KEY]?: InpageBootstrapState;
  };
  const g = globalThis as GlobalWithBootstrap;
  const targetWindow = options.targetWindow ?? (window as unknown as ProviderHostWindow);
  const createTransportForNamespace = options.createTransportForNamespace ?? DEFAULT_CREATE_TRANSPORT_FOR_NAMESPACE;
  const exposedNamespaces = normalizeExposedNamespaces(
    options.exposedNamespaces ?? options.registry.modules.map((module) => module.namespace),
  );
  const eip6963 = options.features?.eip6963 ?? true;

  assertExposedNamespacesMatchRegistry(options.registry, exposedNamespaces);

  const bootstrapState = g[BOOTSTRAP_STATE_KEY];
  if (bootstrapState) {
    assertStableBootstrapState(bootstrapState, {
      registry: options.registry,
      exposedNamespaces,
      targetWindow,
      createTransportForNamespace,
      eip6963,
    });
    bootstrapState.host.initialize();
    return bootstrapState.host;
  }

  const host = createProviderHost({
    targetWindow,
    registry: options.registry,
    createTransportForNamespace,
    features: { eip6963 },
    ...(options.logger ? { logger: options.logger } : {}),
  });

  const nextState: InpageBootstrapState = {
    host,
    registry: options.registry,
    exposedNamespaces,
    targetWindow,
    createTransportForNamespace,
    eip6963,
  };

  Object.defineProperty(g, HOST_KEY, {
    configurable: true,
    enumerable: false,
    value: host,
    writable: false,
  });
  Object.defineProperty(g, BOOTSTRAP_STATE_KEY, {
    configurable: true,
    enumerable: false,
    value: nextState,
    writable: false,
  });

  host.initialize();
  return host;
};
