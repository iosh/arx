import { DEFAULT_AUTO_LOCK_MS } from "../../controllers/unlock/constants.js";
import { UNLOCK_STATE_CHANGED, UNLOCK_TOPICS } from "../../controllers/unlock/topics.js";
import type { UnlockController, UnlockControllerOptions } from "../../controllers/unlock/types.js";
import { InMemoryUnlockController } from "../../controllers/unlock/UnlockController.js";
import type { Messenger } from "../../messenger/Messenger.js";
import type { AccountsService, KeyringMetasService } from "../../services/index.js";
import type { VaultMetaPort, VaultMetaSnapshot } from "../../storage/index.js";
import { VAULT_META_SNAPSHOT_VERSION } from "../../storage/index.js";
import { zeroize } from "../../utils/bytes.js";
import type { VaultService } from "../../vault/types.js";
import { createVaultService } from "../../vault/vaultService.js";
import { KeyringService } from "../keyring/KeyringService.js";
import { encodePayload } from "../keyring/keyring-utils.js";
import type { NamespaceConfig } from "../keyring/namespaces.js";
import type { ControllersBase } from "./controllers.js";

const DEFAULT_PERSIST_DEBOUNCE_MS = 250;

type VaultFactory = () => VaultService;
type UnlockFactory = (options: UnlockControllerOptions) => UnlockController;

export type SessionOptions = {
  vault?: VaultService | VaultFactory;
  unlock?: UnlockFactory;
  autoLockDurationMs?: number;
  persistDebounceMs?: number;
  timers?: UnlockControllerOptions["timers"];
  uuid?: () => string;
  keyringNamespaces?: NamespaceConfig[];
};

export type SessionLayerOptions = Omit<SessionOptions, "keyringNamespaces">;

export type BackgroundSessionServices = {
  vault: VaultService;
  unlock: UnlockController;
  getVaultMetaState(): VaultMetaSnapshot["payload"];
  getLastPersistedVaultMeta(): VaultMetaSnapshot | null;
  persistVaultMeta(): Promise<void>;
  withVaultMetaPersistHold<T>(fn: () => Promise<T>): Promise<T>;
  onStateChanged(listener: () => void): () => void;
};

type SessionLayerParams = {
  bus: Messenger;
  controllers: ControllersBase;
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
  bus,
  controllers: _controllers,
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
  const createVault = (): VaultService => {
    const candidate = sessionOptions?.vault;
    if (!candidate) {
      return createVaultService();
    }
    return typeof candidate === "function" ? (candidate as VaultFactory)() : candidate;
  };

  const baseVault = createVault();
  const unlockFactory =
    sessionOptions?.unlock ?? ((options: UnlockControllerOptions) => new InMemoryUnlockController(options));

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

  const persistVaultMetaImmediate = async (): Promise<void> => {
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
        autoLockDurationMs: unlockState.timeoutMs,
        initializedAt: getOrInitVaultInitializedAt(),
      },
    };

    try {
      await vaultMetaPort.saveVaultMeta(envelope);
      lastPersistedVaultMeta = envelope;
    } catch (error) {
      storageLogger("session: failed to persist vault meta", error);
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
          await persistVaultMetaImmediate();
        }
      }
    }
  };

  const vaultProxy: VaultService = {
    async initialize(params) {
      // Re-initializing should also reset the initializedAt marker.
      vaultInitializedAt = storageNow();
      const envelope = await baseVault.initialize({
        ...params,
        // The vault secret is used to store the keyring payload; seed it with a valid empty payload so
        // first-time hydration doesn't attempt to JSON.parse random bytes.
        secret: params.secret ?? encodePayload({ keyrings: [] }),
      });
      if (!getIsHydrating()) {
        await persistVaultMetaImmediate();
      }
      notifySessionStateChanged();
      return envelope;
    },
    async unlock(params) {
      await baseVault.unlock(params);
    },
    lock() {
      baseVault.lock();
      scheduleVaultMetaPersist();
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
      scheduleVaultMetaPersist();
      notifySessionStateChanged();
    },
    getEnvelope() {
      return baseVault.getEnvelope();
    },
    getStatus() {
      return baseVault.getStatus();
    },
    isUnlocked() {
      return baseVault.isUnlocked();
    },
  };

  const unlockOptions: UnlockControllerOptions = {
    messenger: bus.scope({ name: "unlock", publish: UNLOCK_TOPICS }),
    vault: {
      unlock: async (params) => {
        await vaultProxy.unlock(params);
      },
      lock: vaultProxy.lock.bind(vaultProxy),
      isUnlocked: vaultProxy.isUnlocked.bind(vaultProxy),
    },
    autoLockDurationMs: baseAutoLockDurationMs,
    now: storageNow,
  };

  if (sessionOptions?.timers) {
    unlockOptions.timers = sessionOptions.timers;
  }

  const unlock = unlockFactory(unlockOptions);

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
    // onStateChanged replays the current snapshot; ignore that initial emission to avoid
    // persisting vault metadata when nothing actually changed.
    let lastUnlockState = unlock.getState();
    sessionSubscriptions.push(
      unlock.onStateChanged(() => {
        const next = unlock.getState();
        const isEqual = UNLOCK_STATE_CHANGED.isEqual ?? Object.is;
        if (isEqual(lastUnlockState, next)) {
          lastUnlockState = next;
          return;
        }
        lastUnlockState = next;
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

    try {
      const meta = await vaultMetaPort.loadVaultMeta();
      if (!meta) {
        vaultInitializedAt = null;
        lastPersistedVaultMeta = null;
        unlock.setAutoLockDuration(baseAutoLockDurationMs);
        return;
      }

      lastPersistedVaultMeta = meta;
      vaultInitializedAt = meta.payload.initializedAt;
      unlock.setAutoLockDuration(meta.payload.autoLockDurationMs);

      if (meta.payload.envelope) {
        try {
          vaultProxy.importEnvelope(meta.payload.envelope);
        } catch (error) {
          storageLogger("session: failed to import vault envelope", error);
          try {
            await vaultMetaPort.clearVaultMeta();
          } catch (clearError) {
            storageLogger("session: failed to clear vault meta", clearError);
          }
          vaultInitializedAt = null;
          lastPersistedVaultMeta = null;
          unlock.setAutoLockDuration(baseAutoLockDurationMs);
        }
      }
    } catch (error) {
      storageLogger("session: failed to hydrate vault meta", error);
    }
  };

  const destroySessionLayer = () => {
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
    getVaultMetaState: () => {
      const unlockState = unlock.getState();

      return {
        envelope: vaultProxy.getEnvelope(),
        autoLockDurationMs: unlockState.timeoutMs,
        initializedAt: getOrInitVaultInitializedAt(),
      };
    },
    getLastPersistedVaultMeta: () => lastPersistedVaultMeta,
    persistVaultMeta: () => persistVaultMetaImmediate(),
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
