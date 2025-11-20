import type {
  UnlockController,
  UnlockControllerOptions,
  UnlockMessengerTopics,
} from "../../controllers/unlock/types.js";
import { InMemoryUnlockController } from "../../controllers/unlock/UnlockController.js";
import { EthereumHdKeyring } from "../../keyring/index.js";
import { EIP155_NAMESPACE } from "../../rpc/handlers/namespaces/utils.js";
import type { StoragePort, VaultMetaSnapshot } from "../../storage/index.js";
import { VAULT_META_SNAPSHOT_VERSION } from "../../storage/index.js";
import type { VaultCiphertext, VaultService } from "../../vault/types.js";
import { createVaultService } from "../../vault/vaultService.js";
import { KeyringService } from "../keyring/KeyringService.js";
import type { ControllersBase } from "./controllers.js";
import type { BackgroundMessenger } from "./messenger.js";
import { castMessenger } from "./messenger.js";

const DEFAULT_AUTO_LOCK_MS = 15 * 60 * 1000;
const DEFAULT_PERSIST_DEBOUNCE_MS = 250;

type VaultFactory = () => VaultService;
type UnlockFactory = (options: UnlockControllerOptions) => UnlockController;

export type SessionOptions = {
  vault?: VaultService | VaultFactory;
  unlock?: UnlockFactory;
  autoLockDuration?: number;
  persistDebounceMs?: number;
  timers?: UnlockControllerOptions["timers"];
};

export type BackgroundSessionServices = {
  vault: VaultService;
  unlock: UnlockController;
  getVaultMetaState(): VaultMetaSnapshot["payload"];
  getLastPersistedVaultMeta(): VaultMetaSnapshot | null;
  persistVaultMeta(): Promise<void>;
};

type SessionLayerParams = {
  messenger: BackgroundMessenger;
  controllers: ControllersBase;
  storagePort?: StoragePort;
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
  messenger,
  controllers,
  storagePort,
  storageLogger,
  storageNow,
  hydrationEnabled,
  sessionOptions,
  getIsHydrating,
  getIsDestroyed,
}: SessionLayerParams): SessionLayerResult => {
  const resolveVault = (): VaultService => {
    const candidate = sessionOptions?.vault;
    if (!candidate) {
      return createVaultService();
    }
    return typeof candidate === "function" ? (candidate as VaultFactory)() : candidate;
  };

  const baseVault = resolveVault();
  const unlockFactory =
    sessionOptions?.unlock ?? ((options: UnlockControllerOptions) => new InMemoryUnlockController(options));

  const sessionTimers = sessionOptions?.timers ?? {};
  const sessionSetTimeout = sessionTimers.setTimeout ?? setTimeout;
  const sessionClearTimeout = sessionTimers.clearTimeout ?? clearTimeout;
  const baseAutoLockDuration = sessionOptions?.autoLockDuration ?? DEFAULT_AUTO_LOCK_MS;
  const persistDebounceMs = sessionOptions?.persistDebounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS;

  let vaultInitializedAt: number | null = null;
  let lastPersistedVaultMeta: VaultMetaSnapshot | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionListenersAttached = false;

  const ensureInitializedTimestamp = () => {
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
    if (!storagePort || getIsDestroyed()) {
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
        autoLockDuration: unlockState.timeoutMs,
        initializedAt: ensureInitializedTimestamp(),
        unlockState: {
          isUnlocked: unlockState.isUnlocked,
          lastUnlockedAt: unlockState.lastUnlockedAt,
          nextAutoLockAt: unlockState.nextAutoLockAt,
        },
      },
    };

    try {
      await storagePort.saveVaultMeta(envelope);
      lastPersistedVaultMeta = envelope;
    } catch (error) {
      storageLogger("session: failed to persist vault meta", error);
    }
  };

  const scheduleVaultMetaPersist = () => {
    if (!storagePort || getIsDestroyed() || getIsHydrating()) {
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

  const vaultProxy: VaultService = {
    async initialize(params) {
      const ciphertext = await baseVault.initialize(params);
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
    messenger: castMessenger<UnlockMessengerTopics>(messenger),
    vault: {
      unlock: vaultProxy.unlock.bind(vaultProxy),
      lock: vaultProxy.lock.bind(vaultProxy),
      isUnlocked: vaultProxy.isUnlocked.bind(vaultProxy),
    },
    autoLockDuration: baseAutoLockDuration,
    now: storageNow,
  };

  if (sessionOptions?.timers) {
    unlockOptions.timers = sessionOptions.timers;
  }

  const unlock = unlockFactory(unlockOptions);

  const keyringService = new KeyringService({
    vault: vaultProxy,
    unlock,
    accounts: controllers.accounts,
    namespaces: {
      [EIP155_NAMESPACE]: {
        createKeyring: () => new EthereumHdKeyring(),
      },
    },
    logger: storageLogger,
  });

  keyringService.attach();

  sessionSubscriptions.push(
    keyringService.onEnvelopeUpdated(() => {
      scheduleVaultMetaPersist();
    }),
  );

  const attachSessionListeners = () => {
    if (sessionListenersAttached) return;

    sessionListenersAttached = true;
    sessionSubscriptions.push(
      unlock.onStateChanged(() => {
        scheduleVaultMetaPersist();
      }),
    );
    sessionSubscriptions.push(
      unlock.onLocked(() => {
        scheduleVaultMetaPersist();
      }),
    );
    sessionSubscriptions.push(
      unlock.onUnlocked(() => {
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
    if (!storagePort || !hydrationEnabled) {
      return;
    }

    try {
      const meta = await storagePort.loadVaultMeta();
      if (!meta) {
        vaultInitializedAt = null;
        lastPersistedVaultMeta = null;
        unlock.setAutoLockDuration(baseAutoLockDuration);
        return;
      }

      lastPersistedVaultMeta = meta;
      vaultInitializedAt = meta.payload.initializedAt;
      unlock.setAutoLockDuration(meta.payload.autoLockDuration);

      if (meta.payload.ciphertext) {
        try {
          vaultProxy.importCiphertext(meta.payload.ciphertext);
        } catch (error) {
          storageLogger("session: failed to import vault ciphertext", error);
          try {
            await storagePort.clearVaultMeta();
          } catch (clearError) {
            storageLogger("session: failed to clear vault meta", clearError);
          }
          vaultInitializedAt = null;
          lastPersistedVaultMeta = null;
          unlock.setAutoLockDuration(baseAutoLockDuration);
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
        autoLockDuration: unlockState.timeoutMs,
        initializedAt: ensureInitializedTimestamp(),
        unlockState: {
          isUnlocked: unlockState.isUnlocked,
          lastUnlockedAt: unlockState.lastUnlockedAt,
          nextAutoLockAt: unlockState.nextAutoLockAt,
        },
      };
    },
    getLastPersistedVaultMeta: () => lastPersistedVaultMeta,
    persistVaultMeta: () => persistVaultMetaImmediate(),
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
