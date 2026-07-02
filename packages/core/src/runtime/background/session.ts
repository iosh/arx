import type { Messenger } from "../../messenger/index.js";
import { RpcInvalidRequestError } from "../../rpc/errors.js";
import type { AccountsService, KeyringMetasService } from "../../services/index.js";
import type { VaultMetaPort, VaultMetaSnapshot } from "../../storage/index.js";
import { VAULT_META_SNAPSHOT_VERSION } from "../../storage/index.js";
import { zeroize } from "../../utils/bytes.js";
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
  timers?: UnlockServiceOptions["timers"];
  uuid?: () => string;
  keyringNamespaces?: NamespaceConfig[];
};

export type SessionLayerOptions = Omit<SessionOptions, "keyringNamespaces">;

export type BackgroundSessionServices = {
  vault: VaultService;
  unlock: UnlockService;
  createVault(params: CreateVaultParams): Promise<VaultEnvelope>;
  createVaultWithSecret(params: CreateVaultParams & { secret: Uint8Array }): Promise<VaultEnvelope>;
  importVault(envelope: VaultEnvelope): Promise<VaultEnvelope>;
  clearVault(): Promise<void>;
  getVaultMetaState(): VaultMetaSnapshot["payload"];
  getLastPersistedVaultMeta(): VaultMetaSnapshot | null;
  persistVaultMeta(): Promise<void>;
  withVaultMetaPersistHold<T>(fn: () => Promise<T>): Promise<T>;
  onStateChanged(listener: () => void): () => void;
};

type SessionLayerParams = {
  messenger: Messenger;
  vaultMetaPort?: VaultMetaPort;
  accountsStore: AccountsService;
  keyringMetas: KeyringMetasService;
  keyringNamespaces: readonly NamespaceConfig[];
  storageLogger: (message: string, error?: unknown) => void;
  storageNow: () => number;
  hydrationEnabled: boolean;
  sessionOptions?: SessionLayerOptions;
  getIsHydrating(): boolean;
  getIsDestroyed(): boolean;
};

export type SessionLayerResult = {
  session: BackgroundSessionServices;
  keyringService: KeyringService;
  persistVaultMetaImmediate(): Promise<void>;
  scheduleVaultMetaPersist(): void;
  attachSessionListeners(): void;
  detachSessionListeners(): void;
  cleanupVaultPersistTimer(): void;
  hydrateVaultMeta(): Promise<void>;
  destroySessionLayer(): void;
};

export const initSessionLayer = ({
  messenger,
  vaultMetaPort,
  accountsStore,
  keyringMetas,
  keyringNamespaces,
  storageLogger,
  storageNow,
  hydrationEnabled,
  sessionOptions,
  getIsHydrating,
  getIsDestroyed,
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

  const sessionTimers = sessionOptions?.timers ?? {};
  const sessionSetTimeout = sessionTimers.setTimeout ?? setTimeout;
  const sessionClearTimeout = sessionTimers.clearTimeout ?? clearTimeout;
  const baseAutoLockDurationMs = sessionOptions?.autoLockDurationMs ?? DEFAULT_AUTO_LOCK_MS;
  const persistDebounceMs = sessionOptions?.persistDebounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS;

  let vaultInitializedAt: number | null = null;
  let lastPersistedVaultMeta: VaultMetaSnapshot | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionListenersAttached = false;

  let vaultMetaPersistHold = 0;
  let vaultMetaPersistPending = false;
  const stateChangedListeners = new Set<() => void>();

  const notifySessionStateChanged = () => {
    for (const listener of stateChangedListeners) {
      try {
        listener();
      } catch (error) {
        storageLogger("session: failed to notify state listener", error);
      }
    }
  };

  const getOrInitVaultInitializedAt = () => {
    if (vaultInitializedAt === null) {
      vaultInitializedAt = storageNow();
    }
    return vaultInitializedAt;
  };

  const sessionSubscriptions: Array<() => void> = [];

  const cleanupVaultPersistTimer = () => {
    if (persistTimer !== null) {
      sessionClearTimeout(persistTimer as Parameters<typeof clearTimeout>[0]);
      persistTimer = null;
    }
  };

  const persistVaultMetaImmediate = async (options?: { throwOnError?: boolean }): Promise<void> => {
    if (!vaultMetaPort || getIsDestroyed()) {
      return;
    }

    if (vaultMetaPersistHold > 0) {
      vaultMetaPersistPending = true;
      return;
    }

    const unlockState = unlock.getState();

    const envelope: VaultMetaSnapshot = {
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: storageNow(),
      payload: {
        envelope: vaultProxy.getEnvelope(),
        autoLockDurationMs: unlockState.autoLockDurationMs,
        initializedAt: getOrInitVaultInitializedAt(),
      },
    };

    try {
      await vaultMetaPort.saveVaultMeta(envelope);
      lastPersistedVaultMeta = envelope;
    } catch (error) {
      storageLogger("session: failed to persist vault meta", error);
      if (options?.throwOnError) {
        throw error;
      }
    }
  };

  const scheduleVaultMetaPersist = () => {
    if (!vaultMetaPort || getIsDestroyed() || getIsHydrating()) {
      return;
    }

    if (vaultMetaPersistHold > 0) {
      vaultMetaPersistPending = true;
      cleanupVaultPersistTimer();
      return;
    }

    if (persistDebounceMs <= 0) {
      void persistVaultMetaImmediate();
      return;
    }

    cleanupVaultPersistTimer();
    persistTimer = sessionSetTimeout(() => {
      persistTimer = null;
      void persistVaultMetaImmediate();
    }, persistDebounceMs);
  };

  const withVaultMetaPersistHold = async <T>(fn: () => Promise<T>): Promise<T> => {
    vaultMetaPersistHold += 1;
    let succeeded = false;

    try {
      const result = await fn();
      succeeded = true;
      return result;
    } finally {
      vaultMetaPersistHold -= 1;

      if (vaultMetaPersistHold === 0) {
        if (!succeeded) {
          // Failed atomic section: drop any pending persist work.
          vaultMetaPersistPending = false;
          cleanupVaultPersistTimer();
        } else if (vaultMetaPersistPending) {
          vaultMetaPersistPending = false;
          await persistVaultMetaImmediate({ throwOnError: true });
        }
      }
    }
  };

  const assertVaultLockedAfterMutation = (operation: "initialize" | "importEnvelope") => {
    if (baseVault.getStatus().status === "unlocked") {
      throw new Error(`VaultService.${operation}() must keep the vault locked`);
    }
  };

  const vaultProxy: VaultService = {
    async initialize(params) {
      // Re-initializing should also reset the initializedAt marker.
      vaultInitializedAt = storageNow();
      const envelope = await baseVault.initialize(params);
      assertVaultLockedAfterMutation("initialize");
      if (!getIsHydrating()) {
        await persistVaultMetaImmediate({ throwOnError: true });
      }
      return envelope;
    },
    async unlock(params) {
      await baseVault.unlock(params);
    },
    lock() {
      baseVault.lock();
      scheduleVaultMetaPersist();
    },
    clear() {
      baseVault.clear();
      cleanupVaultPersistTimer();
    },
    exportSecret() {
      return baseVault.exportSecret();
    },
    async verifyPassword(password) {
      await baseVault.verifyPassword(password);
    },
    async commitSecret(params) {
      const envelope = await baseVault.commitSecret(params);
      scheduleVaultMetaPersist();
      return envelope;
    },
    async reencrypt(params) {
      const envelope = await baseVault.reencrypt(params);
      scheduleVaultMetaPersist();
      return envelope;
    },
    importEnvelope(value) {
      baseVault.importEnvelope(value);
      assertVaultLockedAfterMutation("importEnvelope");
      scheduleVaultMetaPersist();
    },
    getEnvelope() {
      return baseVault.getEnvelope();
    },
    getStatus() {
      return baseVault.getStatus();
    },
  };

  const unlockOptions: UnlockServiceOptions = {
    messenger,
    vault: {
      unlock: async (params) => {
        await vaultProxy.unlock(params);
      },
      lock: vaultProxy.lock.bind(vaultProxy),
      getStatus: vaultProxy.getStatus.bind(vaultProxy),
    },
    autoLockDurationMs: baseAutoLockDurationMs,
    now: storageNow,
  };

  if (sessionOptions?.timers) {
    unlockOptions.timers = sessionOptions.timers;
  }

  const unlock = unlockFactory(unlockOptions);

  const assertSessionLockedForVaultLifecycle = (action: SessionVaultLifecycleAction) => {
    const unlockState = unlock.getState();
    const vaultStatus = vaultProxy.getStatus().status;

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

  const createSessionVault = async (params: CreateVaultParams): Promise<VaultEnvelope> => {
    return await createSessionVaultWithSecret({
      password: params.password,
      secret: encodePayload({ keyrings: [] }),
    });
  };

  const createSessionVaultWithSecret = async (
    params: CreateVaultParams & { secret: Uint8Array },
  ): Promise<VaultEnvelope> => {
    assertSessionLockedForVaultLifecycle("createVault");
    try {
      const envelope = await vaultProxy.initialize({
        password: params.password,
        secret: params.secret,
      });
      unlock.syncVaultStatus();
      notifySessionStateChanged();
      return envelope;
    } finally {
      zeroize(params.secret);
    }
  };

  const importSessionVault = async (envelope: VaultEnvelope): Promise<VaultEnvelope> => {
    assertSessionLockedForVaultLifecycle("importVault");
    vaultProxy.importEnvelope(envelope);
    unlock.syncVaultStatus();
    notifySessionStateChanged();
    vaultInitializedAt = storageNow();
    cleanupVaultPersistTimer();
    if (!getIsHydrating()) {
      await persistVaultMetaImmediate({ throwOnError: true });
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
    vaultProxy.clear();
    try {
      await vaultMetaPort?.clearVaultMeta();
    } catch (error) {
      storageLogger("session: failed to clear vault meta", error);
    }
    unlock.syncVaultStatus();
    notifySessionStateChanged();
    void keyringService.attach().catch((error) => storageLogger("session: keyring attach failed", error));
  };

  const keyringService = new KeyringService({
    now: storageNow,
    uuid: sessionOptions?.uuid ?? (() => crypto.randomUUID()),
    vault: vaultProxy,
    unlock,
    accountsStore,
    keyringMetas,
    namespaces: keyringNamespaces.map((namespace) => ({
      ...namespace,
      factories: { ...namespace.factories },
    })),
    logger: storageLogger,
    onHydrationError: (error: unknown) => {
      storageLogger("session: keyring hydration failed; locking session", error);
      unlock.lock("reload");
    },
  });

  void keyringService.attach().catch((error) => storageLogger("session: keyring attach failed", error));

  sessionSubscriptions.push(
    keyringService.onPayloadUpdated(async (payload) => {
      if (!payload) return;
      try {
        await vaultProxy.commitSecret({ secret: payload });
        scheduleVaultMetaPersist();
      } catch (error) {
        storageLogger("session: failed to reseal keyring payload", error);
      } finally {
        zeroize(payload);
      }
    }),
  );

  const attachSessionListeners = () => {
    if (sessionListenersAttached) return;

    sessionListenersAttached = true;
    sessionSubscriptions.push(
      unlock.onStateChanged(() => {
        scheduleVaultMetaPersist();
        notifySessionStateChanged();
      }),
    );
  };

  const detachSessionListeners = () => {
    if (!sessionListenersAttached) return;

    sessionListenersAttached = false;
    sessionSubscriptions.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        storageLogger("session: failed to remove unlock listener", error);
      }
    });
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
        vaultProxy.importEnvelope(meta.payload.envelope);
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

  const destroySessionLayer = () => {
    try {
      unlock.lock("suspend");
    } catch (error) {
      storageLogger("session: failed to lock during destroy", error);
    }

    detachSessionListeners();
    cleanupVaultPersistTimer();
    try {
      keyringService.detach();
    } catch (error) {
      storageLogger("session: failed to detach keyring", error);
    }
  };

  const session: BackgroundSessionServices = {
    vault: vaultProxy,
    unlock,
    createVault: createSessionVault,
    createVaultWithSecret: createSessionVaultWithSecret,
    importVault: importSessionVault,
    clearVault: clearSessionVault,
    getVaultMetaState: () => {
      const unlockState = unlock.getState();

      return {
        envelope: vaultProxy.getEnvelope(),
        autoLockDurationMs: unlockState.autoLockDurationMs,
        initializedAt: getOrInitVaultInitializedAt(),
      };
    },
    getLastPersistedVaultMeta: () => lastPersistedVaultMeta,
    persistVaultMeta: () => persistVaultMetaImmediate({ throwOnError: true }),
    withVaultMetaPersistHold,
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
    persistVaultMetaImmediate,
    scheduleVaultMetaPersist,
    attachSessionListeners,
    detachSessionListeners,
    cleanupVaultPersistTimer,
    hydrateVaultMeta,
    destroySessionLayer,
  };
};
