import type { AccountRecord, KeyringMetaRecord } from "../../storage/records.js";
import type { Payload, VaultKeyringEntry } from "./types.js";

export type RuntimeKeyringReconciliationResult = {
  reconciledMetas: KeyringMetaRecord[];
  reconciledAccounts: AccountRecord[];
  repairedMetas: KeyringMetaRecord[];
  prunedKeyringIds: string[];
};

const buildMinimalKeyringMeta = (entry: VaultKeyringEntry): KeyringMetaRecord => ({
  id: entry.keyringId,
  type: entry.type,
  createdAt: entry.createdAt,
  ...(entry.type === "hd" ? { needsBackup: true } : {}),
});

export const reconcileRuntimeKeyringState = ({
  payload,
  keyringMetas,
  accounts,
}: {
  payload: Payload;
  keyringMetas: KeyringMetaRecord[];
  accounts: AccountRecord[];
}): RuntimeKeyringReconciliationResult => {
  const payloadKeyringIds = new Set(payload.keyrings.map((entry) => entry.keyringId));

  const prunedKeyringIds = keyringMetas.filter((meta) => !payloadKeyringIds.has(meta.id)).map((meta) => meta.id);

  const reconciledMetas = keyringMetas.filter((meta) => payloadKeyringIds.has(meta.id));
  const reconciledAccounts = accounts.filter((account) => payloadKeyringIds.has(account.keyringId));
  const metaIds = new Set(reconciledMetas.map((meta) => meta.id));
  const repairedMetas: KeyringMetaRecord[] = [];

  for (const entry of payload.keyrings) {
    if (metaIds.has(entry.keyringId)) {
      continue;
    }

    const repaired = buildMinimalKeyringMeta(entry);
    repairedMetas.push(repaired);
    reconciledMetas.push(repaired);
    metaIds.add(repaired.id);
  }

  return {
    reconciledMetas,
    reconciledAccounts,
    repairedMetas,
    prunedKeyringIds,
  };
};
