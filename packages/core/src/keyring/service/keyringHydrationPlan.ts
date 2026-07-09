import type { AccountRecord, KeyringMetaRecord } from "../../storage/records.js";
import type { Payload, VaultKeyringEntry } from "./types.js";

export type KeyringHydrationPlan = {
  metasToLoad: KeyringMetaRecord[];
  accountsToLoad: AccountRecord[];
  metasToCreate: KeyringMetaRecord[];
  keyringIdsToRemove: string[];
};

const buildMinimalKeyringMeta = (entry: VaultKeyringEntry): KeyringMetaRecord => ({
  id: entry.keyringId,
  type: entry.type,
  createdAt: entry.createdAt,
  ...(entry.type === "hd" ? { needsBackup: true } : {}),
});

export const buildKeyringHydrationPlan = ({
  payload,
  keyringMetas,
  accounts,
}: {
  payload: Payload;
  keyringMetas: KeyringMetaRecord[];
  accounts: AccountRecord[];
}): KeyringHydrationPlan => {
  const payloadKeyringIds = new Set(payload.keyrings.map((entry) => entry.keyringId));

  const keyringIdsToRemove = keyringMetas.filter((meta) => !payloadKeyringIds.has(meta.id)).map((meta) => meta.id);

  const metasToLoad = keyringMetas.filter((meta) => payloadKeyringIds.has(meta.id));
  const accountsToLoad = accounts.filter((account) => payloadKeyringIds.has(account.keyringId));
  const metaIds = new Set(metasToLoad.map((meta) => meta.id));
  const metasToCreate: KeyringMetaRecord[] = [];

  for (const entry of payload.keyrings) {
    if (metaIds.has(entry.keyringId)) {
      continue;
    }

    const repaired = buildMinimalKeyringMeta(entry);
    metasToCreate.push(repaired);
    metasToLoad.push(repaired);
    metaIds.add(repaired.id);
  }

  return {
    metasToLoad,
    accountsToLoad,
    metasToCreate,
    keyringIdsToRemove,
  };
};
