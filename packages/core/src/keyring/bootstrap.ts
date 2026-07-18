import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { HdKeyringRecord, KeySourceRecord } from "./persistence.js";

export type KeyringBootstrap = Readonly<{
  keySources: readonly KeySourceRecord[];
  hdKeyrings: readonly HdKeyringRecord[];
}>;

export const loadKeyringBootstrap = async (
  readers: Pick<CorePersistenceReaders, "keySources" | "hdKeyrings">,
): Promise<KeyringBootstrap> => {
  const [keySources, hdKeyrings] = await Promise.all([readers.keySources.listAll(), readers.hdKeyrings.listAll()]);

  return { keySources, hdKeyrings };
};
