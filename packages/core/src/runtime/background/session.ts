import type { AccountsService } from "../../accounts/index.js";
import { OWNER_CHANGED } from "../../events/ownerChanged.js";
import type { KeyringMetasPort } from "../../keyring/keyringMetasPort.js";
import type { Messenger } from "../../messenger/index.js";
import { RpcInvalidRequestError } from "../../rpc/errors.js";
import type { VaultMetaPort, VaultMetaSnapshot } from "../../storage/index.js";
import { VAULT_META_SNAPSHOT_VERSION } from "../../storage/index.js";
import type { CreateVaultParams, VaultEnvelope, VaultService } from "../../vault/types.js";
import { createVaultService } from "../../vault/vaultService.js";
import { KeyringService } from "../keyring/KeyringService.js";
import { encodePayload } from "../keyring/keyring-utils.js";
import type { NamespaceConfig } from "../keyring/namespaces.js";
import { DEFAULT_AUTO_LOCK_MS } from "../session/unlock/constants.js";
import { InMemoryUnlockService } from "../session/unlock/InMemoryUnlockService.js";
import type { UnlockService, UnlockServiceOptions } from "../session/unlock/types.js";
import { RuntimeHydrationError } from "./errors.js";

const DEFAULT_PERSIST_DEBOUNCE_MS = 250;

type VaultFactory = () => VaultService;
type UnlockFactory = (options: UnlockServiceOptions) => UnlockService;
type SessionVaultLifecycleAction = "createVault" | "importVault";

export type SessionOptions = {
  vault?: VaultService | VaultFactory;
  unlock?: UnlockFactory;
  autoLockDurationMs?: number;
  persistDebounceMs?: number;
  keyringNamespaces?: NamespaceConfig[];
};

export type SessionLayerOptions = Omit<SessionOptions, "keyringNamespaces">;

export type BackgroundSessionServices = {
  vault: VaultService;
  unlock: UnlockService;
  getStatus(): SessionStatus;
  isUnlocked(): boolean;
  hasInitializedVault(): boolean;
  createVault(params: Omit<CreateVaultParams, "secret">): Promise<VaultEnvelope>;
  createVaultWithSecret(params: CreateVaultParams & { secret: Uint8Array }): Promise<VaultEnvelope>;
  importVault(envelope: VaultEnvelope): Promise<VaultEnvelope>;
  clearVault(): Promise<void>;
  getVaultMetaState(): VaultMetaSnapshot["payload"];
  getLastPersistedVaultMeta(): VaultMetaSnapshot | null;
  persistVaultMetaSnapshot(): Promise<void>;
  onStateChanged(listener: () => void): () => void;
};

export type SessionStatus = {
  status: ReturnType<UnlockService["getState"]>["status"];
  vaultInitialized: boolean;
  isUnlocked: boolean;
  autoLockDurationMs: number;
  nextAutoLockAt: number | null;
};

type SessionLayerParams = {
  messenger: Messenger;
  vaultMetaPort?: VaultMetaPort;
  accountsStore: AccountsService;
  keyringMetas: KeyringMetasPort;
  keyringNamespaces: readonly NamespaceConfig[];
  hydrationEnabled: boolean;
  sessionOptions?: SessionLayerOptions;
  getIsHydrating(): boolean;
};

export type SessionLayerResult = {
  session: BackgroundSessionServices;
  keyringService: KeyringService;
  attachKeyring(): Promise<void>;
  persistVaultMetaImmediate(): Promise<void>;
  scheduleVaultMetaPersist(): void;
  attachSessionListeners(): void;
  hydrateVaultMeta(): Promise<void>;
};

export const initSessionLayer = ({
  messenger,
  vaultMetaPort,
  accountsStore,
  keyringMetas,
  keyringNamespaces,
  hydrationEnabled,
  sessionOptions,
  getIsHydrating,
}: SessionLayerParams): SessionLayerResult => {
  const createBaseVaultService = (): VaultService => {
    const candidate = sessionOptions?.vault;
    if (!candidate) {
      return createVaultService();
    }
    return typeof candidate === "function" ? (candidate as VaultFactory)() : candidate;
  };

  const baseVault = createBaseVaultService();
  const unlockFactory =
    sessionOptions?.unlock ?? ((options: UnlockServiceOptions) => new InMemoryUnlockService(options));

  const baseAutoLockDurationMs = sessionOptions?.autoLockDurationMs ?? DEFAULT_AUTO_LOCK_MS;
  const persistDebounceMs = sessionOptions?.persistDebounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS;

  let vaultInitializedAt: number | null = null;
  let lastPersistedVaultMeta: VaultMetaSnapshot | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionListenersAttached = false;
  let keyringService: KeyringService;

  const stateChangedListeners = new Set<() => void>();

  const notifySessionStateChanged = () => {
    for (const listener of stateChangedListeners) {
      listener();
    }
  };

  const getOrInitVaultInitializedAt = () => {
    if (vaultInitializedAt === null) {
      vaultInitializedAt = Date.now();
    }
    return vaultInitializedAt;
  };

  const cleanupVaultPersistTimer = () => {
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
  };

  const persistVaultMetaImmediate = async (): Promise<void> => {
    if (!vaultMetaPort) {
      return;
    }

    const unlockState = unlock.getState();

    const envelope: VaultMetaSnapshot = {
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: Date.now(),
      payload: {
        envelope: baseVault.getEnvelope(),
        autoLockDurationMs: unlockState.autoLockDurationMs,
        initializedAt: getOrInitVaultInitializedAt(),
      },
    };

    await vaultMetaPort.saveVaultMeta(envelope);
    lastPersistedVaultMeta = envelope;
  };

  const scheduleVaultMetaPersist = () => {
    if (!vaultMetaPort || getIsHydrating()) {
      return;
    }

    if (persistDebounceMs <= 0) {
      void persistVaultMetaImmediate();
      return;
    }

    cleanupVaultPersistTimer();
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistVaultMetaImmediate();
    }, persistDebounceMs);
  };

  const assertVaultLockedAfterMutation = (operation: "initialize" | "loadEnvelope") => {
    if (baseVault.getStatus() === "unlocked") {
      throw new Error(`VaultService.${operation}() must keep the vault locked`);
    }
  };

  const unlockOptions: UnlockServiceOptions = {
    messenger,
    vault: {
      unlock: async (params) => {
        await baseVault.unlock(params);
      },
      lock: () => {
        baseVault.lock();
        scheduleVaultMetaPersist();
      },
      getStatus: () => baseVault.getStatus(),
    },
    autoLockDurationMs: baseAutoLockDurationMs,
  };

  const unlock = unlockFactory(unlockOptions);

  const keyringMetasWithEvents: KeyringMetasPort = {
    get: (id) => keyringMetas.get(id),
    list: () => keyringMetas.list(),
    upsert: async (record) => {
      await keyringMetas.upsert(record);
      messenger.publish(OWNER_CHANGED, { topic: "identity", change: "keyring", keyringId: record.id });
    },
    remove: async (id) => {
      await keyringMetas.remove(id);
      messenger.publish(OWNER_CHANGED, { topic: "identity", change: "keyring", keyringId: id });
    },
  };

  const assertSessionLockedForVaultLifecycle = (action: SessionVaultLifecycleAction) => {
    const unlockState = unlock.getState();
    const vaultStatus = baseVault.getStatus();

    if (unlockState.status !== "unlocked" && vaultStatus !== "unlocked") {
      return;
    }

    throw new RpcInvalidRequestError({
      message: `${action} requires the session to be locked`,
      details: {
        action,
        unlockState: unlockState.status,
        vaultState: vaultStatus,
      },
    });
  };

  const createSessionVault = async (params: Omit<CreateVaultParams, "secret">): Promise<VaultEnvelope> => {
    return await createSessionVaultWithSecret({
      password: params.password,
      secret: encodePayload({ keyrings: [] }),
      persist: true,
    });
  };

  const createSessionVaultWithSecret = async (
    params: CreateVaultParams & { secret: Uint8Array; persist?: boolean },
  ): Promise<VaultEnvelope> => {
    assertSessionLockedForVaultLifecycle("createVault");
    vaultInitializedAt = Date.now();
    const envelope = await baseVault.initialize({
      password: params.password,
      secret: params.secret,
    });
    assertVaultLockedAfterMutation("initialize");
    unlock.syncVaultStatus();
    notifySessionStateChanged();
    if (params.persist === true && !getIsHydrating()) {
      await persistVaultMetaImmediate();
    }
    return envelope;
  };

  const importSessionVault = async (envelope: VaultEnvelope): Promise<VaultEnvelope> => {
    assertSessionLockedForVaultLifecycle("importVault");
    baseVault.loadEnvelope(envelope);
    assertVaultLockedAfterMutation("loadEnvelope");
    unlock.syncVaultStatus();
    notifySessionStateChanged();
    vaultInitializedAt = Date.now();
    cleanupVaultPersistTimer();
    if (!getIsHydrating()) {
      await persistVaultMetaImmediate();
    }

    const importedEnvelope = baseVault.getEnvelope();
    if (!importedEnvelope) {
      throw new Error("Session vault import completed without an envelope");
    }

    return importedEnvelope;
  };

  const clearSessionVault = async (): Promise<void> => {
    cleanupVaultPersistTimer();
    vaultInitializedAt = null;
    lastPersistedVaultMeta = null;
    unlock.lock("reload");
    keyringService.detach();
    baseVault.clear();
    cleanupVaultPersistTimer();
    await vaultMetaPort?.clearVaultMeta();
    unlock.syncVaultStatus();
    notifySessionStateChanged();
    await keyringService.attach();
  };

  keyringService = new KeyringService({
    vault: baseVault,
    unlock,
    accountsStore,
    keyringMetas: keyringMetasWithEvents,
    namespaces: keyringNamespaces.map((namespace) => ({
      ...namespace,
      factories: { ...namespace.factories },
    })),
    onHydrationError: () => {
      unlock.lock("reload");
    },
  });

  keyringService.onPayloadUpdated(async (payload) => {
    if (!payload) return;
    await baseVault.commitSecret({ secret: payload });
    scheduleVaultMetaPersist();
  });

  const attachSessionListeners = () => {
    if (sessionListenersAttached) return;

    sessionListenersAttached = true;
    unlock.onStateChanged(() => {
      scheduleVaultMetaPersist();
      notifySessionStateChanged();
    });
  };

  const sessionUnlock: UnlockService = {
    getState: () => unlock.getState(),
    isUnlocked: () => unlock.isUnlocked(),
    unlock: async (params) => {
      await unlock.unlock(params);
      await keyringService.attach();
    },
    lock: (reason) => unlock.lock(reason),
    syncVaultStatus: () => unlock.syncVaultStatus(),
    scheduleAutoLock: (duration) => unlock.scheduleAutoLock(duration),
    setAutoLockDuration: (duration) => unlock.setAutoLockDuration(duration),
    onStateChanged: (handler) => unlock.onStateChanged(handler),
    onLocked: (handler) => unlock.onLocked(handler),
    onUnlocked: (handler) => unlock.onUnlocked(handler),
  };

  const hydrateVaultMeta = async () => {
    if (!vaultMetaPort || !hydrationEnabled) {
      return;
    }

    let meta: VaultMetaSnapshot | null;
    try {
      meta = await vaultMetaPort.loadVaultMeta();
    } catch (error) {
      throw new RuntimeHydrationError({
        owner: "vault",
        resource: "vaultMeta",
        cause: error,
      });
    }

    if (!meta) {
      vaultInitializedAt = null;
      lastPersistedVaultMeta = null;
      unlock.setAutoLockDuration(baseAutoLockDurationMs);
      unlock.syncVaultStatus();
      return;
    }

    lastPersistedVaultMeta = meta;
    vaultInitializedAt = meta.payload.initializedAt;
    unlock.setAutoLockDuration(meta.payload.autoLockDurationMs);

    if (meta.payload.envelope) {
      try {
        baseVault.loadEnvelope(meta.payload.envelope);
        assertVaultLockedAfterMutation("loadEnvelope");
      } catch (error) {
        throw new RuntimeHydrationError({
          owner: "vault",
          resource: "vaultEnvelope",
          cause: error,
        });
      }
      unlock.syncVaultStatus();
      notifySessionStateChanged();
    }
  };

  const session: BackgroundSessionServices = {
    vault: baseVault,
    unlock: sessionUnlock,
    getStatus: () => {
      const unlockState = unlock.getState();
      const vaultStatus = baseVault.getStatus();
      return {
        status: unlockState.status,
        vaultInitialized: vaultStatus !== "uninitialized",
        isUnlocked: unlockState.status === "unlocked",
        autoLockDurationMs: unlockState.autoLockDurationMs,
        nextAutoLockAt: unlockState.nextAutoLockAt,
      };
    },
    isUnlocked: () => sessionUnlock.isUnlocked(),
    hasInitializedVault: () => baseVault.getStatus() !== "uninitialized",
    createVault: createSessionVault,
    createVaultWithSecret: createSessionVaultWithSecret,
    importVault: importSessionVault,
    clearVault: clearSessionVault,
    getVaultMetaState: () => {
      const unlockState = unlock.getState();

      return {
        envelope: baseVault.getEnvelope(),
        autoLockDurationMs: unlockState.autoLockDurationMs,
        initializedAt: getOrInitVaultInitializedAt(),
      };
    },
    getLastPersistedVaultMeta: () => lastPersistedVaultMeta,
    persistVaultMetaSnapshot: () => persistVaultMetaImmediate(),
    onStateChanged: (listener) => {
      stateChangedListeners.add(listener);
      return () => {
        stateChangedListeners.delete(listener);
      };
    },
  };

  return {
    session,
    keyringService,
    attachKeyring: () => keyringService.attach(),
    persistVaultMetaImmediate,
    scheduleVaultMetaPersist,
    attachSessionListeners,
    hydrateVaultMeta,
  };
};
