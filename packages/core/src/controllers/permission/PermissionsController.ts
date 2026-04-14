import { ArxReasons, arxError } from "@arx/errors";
import type { ChainRef } from "../../chains/ids.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import {
  arePermissionChainStatesEqual,
  buildPermissionAuthorization,
  buildPermissionRecordFromChainStates,
  buildPermissionsStateFromRecords,
  buildValidatedPermissionChainStates,
  cloneChainStates,
  cloneOriginPermissionState,
  clonePermissionsState,
  mergeGrantedPermissionChainStates,
  parsePermissionAccountKeysForNamespace,
  parsePermissionChainRefForNamespace,
  parsePermissionNamespace,
} from "./state.js";
import { PERMISSION_ORIGIN_CHANGED, PERMISSION_STATE_CHANGED, type PermissionsMessenger } from "./topics.js";
import type {
  ChainPermissionAuthorization,
  GrantAuthorizationOptions,
  OriginPermissions,
  PermissionAuthorization,
  PermissionsEvents,
  PermissionsReader,
  PermissionsState,
  PermissionsWriter,
  RevokeChainAuthorizationOptions,
  RevokeNamespaceAuthorizationOptions,
  SetChainAccountKeysOptions,
} from "./types.js";

const sortStrings = <T extends string>(values: readonly T[]): T[] => {
  return [...values].sort((left, right) => left.localeCompare(right));
};

export type PermissionsControllerOptions = {
  messenger: PermissionsMessenger;
  port: PermissionsPort;
};

export class PermissionsController implements PermissionsReader, PermissionsWriter, PermissionsEvents {
  #messenger: PermissionsMessenger;
  #port: PermissionsPort;
  #state: PermissionsState = { origins: {} };
  #ready: Promise<void>;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor({ messenger, port }: PermissionsControllerOptions) {
    this.#messenger = messenger;
    this.#port = port;
    this.#ready = this.#initialize();
  }

  waitForHydration(): Promise<void> {
    return this.#ready;
  }

  getState(): PermissionsState {
    return clonePermissionsState(this.#state);
  }

  getAuthorization(origin: string, options: { namespace: string }): PermissionAuthorization | null {
    const namespace = parsePermissionNamespace(options.namespace);
    const entry = this.#state.origins[origin]?.[namespace];
    if (!entry) return null;

    return buildPermissionAuthorization(origin, namespace, entry.chains);
  }

  getChainAuthorization(
    origin: string,
    options: { namespace: string; chainRef: ChainRef },
  ): ChainPermissionAuthorization | null {
    const namespace = parsePermissionNamespace(options.namespace);
    const chainRef = parsePermissionChainRefForNamespace(namespace, options.chainRef);
    const chain = this.#state.origins[origin]?.[namespace]?.chains[chainRef];
    if (!chain) return null;

    return {
      origin,
      namespace,
      chainRef,
      accountKeys: [...chain.accountKeys],
    };
  }

  listOriginPermissions(origin: string): PermissionAuthorization[] {
    const namespaces = this.#state.origins[origin];
    if (!namespaces) return [];

    return sortStrings(Object.keys(namespaces)).flatMap((namespace) => {
      const entry = namespaces[namespace];
      if (!entry) return [];

      return [buildPermissionAuthorization(origin, namespace, entry.chains)];
    });
  }

  async grantAuthorization(origin: string, options: GrantAuthorizationOptions): Promise<PermissionAuthorization> {
    await this.#ready;

    return await this.#enqueueWrite(async () => {
      const namespace = parsePermissionNamespace(options.namespace);
      const grantedChains = buildValidatedPermissionChainStates(namespace, options.chains);
      const currentChains = this.#state.origins[origin]?.[namespace]?.chains ?? null;
      const nextChains = mergeGrantedPermissionChainStates(currentChains, grantedChains);

      if (currentChains && arePermissionChainStatesEqual(currentChains, nextChains)) {
        return buildPermissionAuthorization(origin, namespace, currentChains);
      }

      await this.#port.upsert(buildPermissionRecordFromChainStates(origin, namespace, nextChains));
      this.#setNamespaceAuthorization(origin, namespace, nextChains);

      return buildPermissionAuthorization(origin, namespace, nextChains);
    });
  }

  async setChainAccountKeys(origin: string, options: SetChainAccountKeysOptions): Promise<PermissionAuthorization> {
    await this.#ready;

    return await this.#enqueueWrite(async () => {
      const namespace = parsePermissionNamespace(options.namespace);
      const currentChains = this.#state.origins[origin]?.[namespace]?.chains;
      if (!currentChains) {
        throw arxError({
          reason: ArxReasons.PermissionNotConnected,
          message: `Origin "${origin}" is not connected to namespace "${namespace}"`,
          data: { origin, namespace },
        });
      }

      const chainRef = parsePermissionChainRefForNamespace(namespace, options.chainRef);
      const currentChain = currentChains[chainRef];
      if (!currentChain) {
        throw arxError({
          reason: ArxReasons.PermissionNotConnected,
          message: `Origin "${origin}" is not connected to chain "${chainRef}"`,
          data: { origin, namespace, chainRef },
        });
      }

      const accountKeys = parsePermissionAccountKeysForNamespace(namespace, options.accountKeys);
      const nextChains = cloneChainStates(currentChains);
      nextChains[chainRef] = { accountKeys };

      if (arePermissionChainStatesEqual(currentChains, nextChains)) {
        return buildPermissionAuthorization(origin, namespace, currentChains);
      }

      await this.#port.upsert(buildPermissionRecordFromChainStates(origin, namespace, nextChains));
      this.#setNamespaceAuthorization(origin, namespace, nextChains);

      return buildPermissionAuthorization(origin, namespace, nextChains);
    });
  }

  async revokeChainAuthorization(origin: string, options: RevokeChainAuthorizationOptions): Promise<void> {
    await this.#ready;

    await this.#enqueueWrite(async () => {
      const namespace = parsePermissionNamespace(options.namespace);
      const currentChains = this.#state.origins[origin]?.[namespace]?.chains;
      if (!currentChains) {
        return;
      }

      const chainRef = parsePermissionChainRefForNamespace(namespace, options.chainRef);
      if (!currentChains[chainRef]) {
        return;
      }

      const nextChains = cloneChainStates(currentChains);
      delete nextChains[chainRef];

      if (Object.keys(nextChains).length === 0) {
        await this.#port.remove({ origin, namespace });
        this.#removeNamespaceAuthorization(origin, namespace);
        return;
      }

      await this.#port.upsert(buildPermissionRecordFromChainStates(origin, namespace, nextChains));
      this.#setNamespaceAuthorization(origin, namespace, nextChains);
    });
  }

  async revokeNamespaceAuthorization(origin: string, options: RevokeNamespaceAuthorizationOptions): Promise<void> {
    await this.#ready;

    await this.#enqueueWrite(async () => {
      const namespace = parsePermissionNamespace(options.namespace);
      if (!this.#state.origins[origin]?.[namespace]) {
        return;
      }

      await this.#port.remove({ origin, namespace });
      this.#removeNamespaceAuthorization(origin, namespace);
    });
  }

  async revokeOriginPermissions(origin: string): Promise<void> {
    await this.#ready;

    await this.#enqueueWrite(async () => {
      if (!this.#state.origins[origin]) {
        return;
      }

      await this.#port.clearOrigin(origin);
      this.#removeOrigin(origin);
    });
  }

  onStateChanged(handler: (state: PermissionsState) => void): () => void {
    return this.#messenger.subscribe(PERMISSION_STATE_CHANGED, handler, { replay: "snapshot" });
  }

  onOriginChanged(handler: (payload: OriginPermissions) => void): () => void {
    return this.#messenger.subscribe(PERMISSION_ORIGIN_CHANGED, handler);
  }

  async #initialize(): Promise<void> {
    const records = await this.#port.listAll();
    this.#state = buildPermissionsStateFromRecords(records);
    this.#publishState();

    for (const origin of sortStrings(Object.keys(this.#state.origins))) {
      this.#publishOrigin(origin);
    }
  }

  async #enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#writeQueue.then(task, task);
    this.#writeQueue = run.then(
      () => undefined,
      () => undefined,
    );

    return await run;
  }

  #setNamespaceAuthorization(origin: string, namespace: string, nextChains: PermissionAuthorization["chains"]) {
    const nextOriginState = cloneOriginPermissionState(this.#state.origins[origin] ?? {});
    nextOriginState[namespace] = {
      chains: cloneChainStates(nextChains),
    };

    this.#state = {
      origins: {
        ...this.#state.origins,
        [origin]: nextOriginState,
      },
    };

    this.#publishState();
    this.#publishOrigin(origin);
  }

  #removeNamespaceAuthorization(origin: string, namespace: string) {
    const currentOriginState = this.#state.origins[origin];
    if (!currentOriginState) {
      return;
    }

    const nextOriginState = cloneOriginPermissionState(currentOriginState);
    delete nextOriginState[namespace];

    if (Object.keys(nextOriginState).length === 0) {
      this.#removeOrigin(origin);
      return;
    }

    this.#state = {
      origins: {
        ...this.#state.origins,
        [origin]: nextOriginState,
      },
    };

    this.#publishState();
    this.#publishOrigin(origin);
  }

  #removeOrigin(origin: string) {
    if (!this.#state.origins[origin]) {
      return;
    }

    const nextOrigins = { ...this.#state.origins };
    delete nextOrigins[origin];
    this.#state = { origins: nextOrigins };

    this.#publishState();
    this.#publishOrigin(origin);
  }

  #publishState() {
    this.#messenger.publish(PERMISSION_STATE_CHANGED, clonePermissionsState(this.#state), { force: true });
  }

  #publishOrigin(origin: string) {
    this.#messenger.publish(
      PERMISSION_ORIGIN_CHANGED,
      {
        origin,
        namespaces: cloneOriginPermissionState(this.#state.origins[origin] ?? {}),
      },
      { force: true },
    );
  }
}
