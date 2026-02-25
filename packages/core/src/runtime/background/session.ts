import { getAccountCodec } from "../../accounts/codec.js";
import { DEFAULT_AUTO_LOCK_MS } from "../../controllers/unlock/constants.js";
import { UNLOCK_STATE_CHANGED, UNLOCK_TOPICS } from "../../controllers/unlock/topics.js";
import type { UnlockController, UnlockControllerOptions } from "../../controllers/unlock/types.js";
import { InMemoryUnlockController } from "../../controllers/unlock/UnlockController.js";
import { EvmHdKeyring, EvmPrivateKeyKeyring } from "../../keyring/index.js";
import type { Messenger } from "../../messenger/Messenger.js";
import { EIP155_NAMESPACE } from "../../rpc/handlers/namespaces/utils.js";
import type { AccountsService, KeyringMetasService } from "../../services/index.js";
import type { VaultMetaPort, VaultMetaSnapshot } from "../../storage/index.js";
import { VAULT_META_SNAPSHOT_VERSION } from "../../storage/index.js";
import type { VaultCiphertext, VaultService } from "../../vault/types.js";
import { zeroize } from "../../vault/utils.js";
import { createVaultService } from "../../vault/vaultService.js";
import { KeyringService } from "../keyring/KeyringService.js";
import { encodePayload } from "../keyring/keyring-utils.js";
import type { NamespaceConfig } from "../keyring/namespaces.js";
import type { ControllersBase } from "./controllers.js";

const DEFAULT_PERSIST_DEBOUNCE_MS = 250;
const DEFAULT_EIP155_CHAIN_REF = "eip155:1" as const;

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

export type BackgroundSessionServices = {
  vault: VaultService;
  unlock: UnlockController;
  getVaultMetaState(): VaultMetaSnapshot["payload"];
  getLastPersistedVaultMeta(): VaultMetaSnapshot | null;
  persistVaultMeta(): Promise<void>;
  withVaultMetaPersistHold<T>(fn: () => Promise<T>): Promise<T>;
};

type SessionLayerParams = {
  bus: Messenger;
  controllers: ControllersBase;
  vaultMetaPort?: VaultMetaPort;
  accountsStore: AccountsService;
  keyringMetas: KeyringMetasService;
  storageLogger: (message: string, error?: unknown) => void;
  storageNow: () => number;
  hydrationEnabled: boolean;
  sessionOptions?: SessionOptions;
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

  const getOrInitVaultInitializedAt = () => {
    if (vaultInitializedAt === null) {
      vaultInitializedAt = storageNow();
    }
    return vaultInitializedAt;
  };

  const updateInitializedAtFromCiphertext = (ciphertext: VaultCiphertext | null | undefined) => {
    if (!ciphertext) {
      return;
    }
    vaultInitializedAt = ciphertext.createdAt;
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

    const ciphertext = vaultProxy.getCiphertext();
    if (ciphertext) {
      updateInitializedAtFromCiphertext(ciphertext);
    }

    const unlockState = unlock.getState();

    const envelope: VaultMetaSnapshot = {
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: storageNow(),
      payload: {
        ciphertext,
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
      const ciphertext = await baseVault.initialize({
        ...params,
        // The vault secret is used to store the keyring payload; seed it with a valid empty payload so
        // first-time hydration doesn't attempt to JSON.parse random bytes.
        secret: params.secret ?? encodePayload({ keyrings: [] }),
      });
      updateInitializedAtFromCiphertext(ciphertext);
      if (!getIsHydrating()) {
        await persistVaultMetaImmediate();
      }
      return ciphertext;
    },
    async unlock(params) {
      const secret = await baseVault.unlock(params);
      if (params.ciphertext) {
        updateInitializedAtFromCiphertext(params.ciphertext);
      } else {
        updateInitializedAtFromCiphertext(baseVault.getCiphertext());
      }
      return secret;
    },
    lock() {
      baseVault.lock();
      scheduleVaultMetaPersist();
    },
    exportKey() {
      return baseVault.exportKey();
    },
    async seal(params) {
      const ciphertext = await baseVault.seal(params);
      updateInitializedAtFromCiphertext(ciphertext);
      if (!getIsHydrating()) {
        await persistVaultMetaImmediate();
      }
      return ciphertext;
    },
    async verifyPassword(password) {
      await baseVault.verifyPassword(password);
    },
    async reseal(params) {
      const ciphertext = await baseVault.reseal(params);
      updateInitializedAtFromCiphertext(ciphertext);
      scheduleVaultMetaPersist();
      return ciphertext;
    },
    importCiphertext(value) {
      baseVault.importCiphertext(value);
      updateInitializedAtFromCiphertext(value);
      scheduleVaultMetaPersist();
    },
    getCiphertext() {
      return baseVault.getCiphertext();
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
        const secret = await vaultProxy.unlock(params);
        // Reduce sensitive bytes copies: the vault keeps its own in-memory secret.
        zeroize(secret);
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

  const defaultKeyringNamespaces: NamespaceConfig[] = [
    {
      namespace: EIP155_NAMESPACE,
      defaultChainRef: DEFAULT_EIP155_CHAIN_REF,
      codec: getAccountCodec(EIP155_NAMESPACE),
      factories: {
        hd: () => new EvmHdKeyring(),
        "private-key": () => new EvmPrivateKeyKeyring(),
      },
    },
  ];

  const keyringService = new KeyringService({
    now: storageNow,
    uuid: sessionOptions?.uuid ?? (() => crypto.randomUUID()),
    vault: vaultProxy,
    unlock,
    accountsStore,
    keyringMetas,
    namespaces: sessionOptions?.keyringNamespaces ?? defaultKeyringNamespaces,
    logger: storageLogger,
  });

  void keyringService.attach().catch((error) => storageLogger("session: keyring attach failed", error));

  sessionSubscriptions.push(
    keyringService.onPayloadUpdated(async (payload) => {
      if (!payload) return;
      try {
        await vaultProxy.reseal({ secret: payload });
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

      if (meta.payload.ciphertext) {
        try {
          vaultProxy.importCiphertext(meta.payload.ciphertext);
        } catch (error) {
          storageLogger("session: failed to import vault ciphertext", error);
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
        ciphertext: vaultProxy.getCiphertext(),
        autoLockDurationMs: unlockState.timeoutMs,
        initializedAt: getOrInitVaultInitializedAt(),
      };
    },
    getLastPersistedVaultMeta: () => lastPersistedVaultMeta,
    persistVaultMeta: () => persistVaultMetaImmediate(),
    withVaultMetaPersistHold,
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
