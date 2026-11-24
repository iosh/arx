import type { PersistenceWriter } from "./corePersistence.js";
import type { PersistenceChange } from "./persistenceTypes.js";

/** Prepared and committed within the same mutation queue run. */
export type PreparedUpdate = Readonly<{
  persistenceChanges: readonly PersistenceChange[];
  /** Applies committed state synchronously and must not throw. */
  activate(): void;
  /** Publishes this update's events after every update is active; must be synchronous and not throw. */
  publish(): void;
}>;

/** Commit once, activate every update, then publish. The rest of the queue run must stay synchronous. */
export const commitUpdates = async (
  commit: PersistenceWriter["commit"],
  updates: readonly (PreparedUpdate | null)[],
): Promise<void> => {
  const prepared = updates.filter((update) => update !== null);
  if (prepared.length === 0) return;

  await commit(prepared.flatMap((update) => update.persistenceChanges));

  for (const update of prepared) update.activate();
  for (const update of prepared) update.publish();
};
