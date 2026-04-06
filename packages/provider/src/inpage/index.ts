import { EIP155_NAMESPACE } from "@arx/core";
import type { ProviderHost, ProviderHostWindow } from "../host/index.js";
import { createProviderHost } from "../host/index.js";
import type { ProviderModule } from "../modules.js";
import { eip155TransportCodec } from "../namespaces/eip155/transportCodec.js";
import { WindowPostMessageTransport } from "../transport/index.js";
import type { Transport } from "../types/index.js";

export type BootstrapInpageProviderOptions = {
  modules: readonly ProviderModule[];
  prewarmNamespaces?: readonly string[];
  targetWindow?: ProviderHostWindow;
  createTransportForNamespace?: (namespace: string) => Transport;
  logger?: Readonly<{ debug?: (message: string, meta?: unknown) => void }>;
};

const BOOTSTRAP_STATE_KEY = Symbol.for("com.arx.wallet/inpageBootstrapState");

type InpageBootstrapState = Readonly<{
  host: ProviderHost;
  modules: readonly ProviderModule[];
  prewarmNamespaces: readonly string[];
  targetWindow: ProviderHostWindow;
  createTransportForNamespace: (namespace: string) => Transport;
}>;

const DEFAULT_CREATE_TRANSPORT_FOR_NAMESPACE = (namespace: string) => {
  switch (namespace) {
    case EIP155_NAMESPACE:
      return new WindowPostMessageTransport({ namespace, codec: eip155TransportCodec });

    default:
      throw new Error(`bootstrapInpageProvider has no default transport codec for namespace "${namespace}"`);
  }
};

const listModuleNamespaces = (modules: readonly ProviderModule[]) => {
  return modules.map((module) => module.namespace);
};

const parseNamespaceList = (namespaces: readonly string[], fieldName: string) => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const namespace of namespaces) {
    const resolvedNamespace = namespace.trim();
    if (!resolvedNamespace) {
      throw new Error(`bootstrapInpageProvider requires non-empty entries in ${fieldName}`);
    }
    if (seen.has(resolvedNamespace)) {
      throw new Error(`bootstrapInpageProvider received duplicate ${fieldName} entry "${resolvedNamespace}"`);
    }

    seen.add(resolvedNamespace);
    normalized.push(resolvedNamespace);
  }

  normalized.sort();
  return normalized;
};

const sameNamespaces = (left: readonly string[], right: readonly string[]) => {
  return left.length === right.length && left.every((namespace, index) => namespace === right[index]);
};

const assertInstalledNamespaces = (
  modules: readonly ProviderModule[],
  namespaces: readonly string[],
  fieldName: string,
) => {
  const installedNamespaces = new Set(listModuleNamespaces(modules));

  for (const namespace of namespaces) {
    if (installedNamespaces.has(namespace)) {
      continue;
    }

    throw new Error(
      `bootstrapInpageProvider received ${fieldName} entry "${namespace}" that is not installed; expected one of [${[...installedNamespaces].join(", ")}]`,
    );
  }
};

const assertStableBootstrapState = (current: InpageBootstrapState, next: Omit<InpageBootstrapState, "host">) => {
  const changedFields: string[] = [];

  if (current.modules !== next.modules) {
    changedFields.push("modules");
  }
  if (!sameNamespaces(current.prewarmNamespaces, next.prewarmNamespaces)) {
    changedFields.push("prewarmNamespaces");
  }
  if (current.targetWindow !== next.targetWindow) {
    changedFields.push("targetWindow");
  }
  if (current.createTransportForNamespace !== next.createTransportForNamespace) {
    changedFields.push("createTransportForNamespace");
  }
  if (changedFields.length === 0) {
    return;
  }

  throw new Error(`bootstrapInpageProvider must be called with stable options; changed ${changedFields.join(", ")}`);
};

/**
 * Boots the page-side provider host once for the current page context.
 */
export const bootstrapInpageProvider = (options: BootstrapInpageProviderOptions): ProviderHost => {
  type GlobalWithBootstrap = typeof globalThis & {
    [BOOTSTRAP_STATE_KEY]?: InpageBootstrapState;
  };
  const g = globalThis as GlobalWithBootstrap;
  const targetWindow = options.targetWindow ?? (window as unknown as ProviderHostWindow);
  const createTransportForNamespace = options.createTransportForNamespace ?? DEFAULT_CREATE_TRANSPORT_FOR_NAMESPACE;
  const prewarmNamespaces = parseNamespaceList(options.prewarmNamespaces ?? [], "prewarmNamespaces");

  assertInstalledNamespaces(options.modules, prewarmNamespaces, "prewarmNamespaces");

  const bootstrapState = g[BOOTSTRAP_STATE_KEY];
  if (bootstrapState) {
    assertStableBootstrapState(bootstrapState, {
      modules: options.modules,
      prewarmNamespaces,
      targetWindow,
      createTransportForNamespace,
    });
    bootstrapState.host.initialize();
    if (prewarmNamespaces.length > 0) {
      void bootstrapState.host.prewarmNamespaces(prewarmNamespaces);
    }
    return bootstrapState.host;
  }

  const host = createProviderHost({
    targetWindow,
    modules: options.modules,
    createTransportForNamespace,
    ...(options.logger ? { logger: options.logger } : {}),
  });
  const destroyHost = host.destroy.bind(host);

  const nextState: InpageBootstrapState = {
    host,
    modules: options.modules,
    prewarmNamespaces,
    targetWindow,
    createTransportForNamespace,
  };

  Object.defineProperty(g, BOOTSTRAP_STATE_KEY, {
    configurable: true,
    enumerable: false,
    value: nextState,
    writable: false,
  });
  host.destroy = () => {
    try {
      destroyHost();
    } finally {
      const currentState = g[BOOTSTRAP_STATE_KEY];
      if (currentState?.host === host) {
        Reflect.deleteProperty(g, BOOTSTRAP_STATE_KEY);
      }
    }
  };

  host.initialize();
  if (prewarmNamespaces.length > 0) {
    void host.prewarmNamespaces(prewarmNamespaces);
  }
  return host;
};
