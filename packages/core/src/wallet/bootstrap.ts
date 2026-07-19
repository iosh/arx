import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import { AUTO_LOCK_SETTING_KEY } from "../settings/persistence.js";
import { DEFAULT_AUTO_LOCK_DURATION_MS } from "./AutoLockController.js";

export type WalletBootstrap = Readonly<{
  autoLockDurationMs: number;
}>;

export const loadWalletBootstrap = async (
  readers: Pick<CorePersistenceReaders, "settings">,
): Promise<WalletBootstrap> => {
  const autoLock = await readers.settings.get(AUTO_LOCK_SETTING_KEY);
  return {
    autoLockDurationMs: autoLock?.durationMs ?? DEFAULT_AUTO_LOCK_DURATION_MS,
  };
};
