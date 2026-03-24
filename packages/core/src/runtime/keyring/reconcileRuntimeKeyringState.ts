import { type AccountRecord, type KeyringMetaRecord, KeyringMetaRecordSchema } from "../../storage/records.js";
import type { Payload, VaultKeyringEntry } from "./types.js";

export type RuntimeKeyringReconciliationResult = {
  reconciledMetas: KeyringMetaRecord[];
  reconciledAccounts: AccountRecord[];
  repairedMetas: KeyringMetaRecord[];
  prunedKeyringIds: string[];
};

const buildMinimalKeyringMeta = (entry: VaultKeyringEntry): KeyringMetaRecord =>
  KeyringMetaRecordSchema.parse({
    id: entry.keyringId,
    type: entry.type,
    createdAt: entry.createdAt,
    ...(entry.type === "hd" ? { needsBackup: true } : {}),
  });

export const reconcileRuntimeKeyringState = ({
  payload,
  keyringMetas,
  accounts,
  logger,
}: {
  payload: Payload;
  keyringMetas: KeyringMetaRecord[];
  accounts: AccountRecord[];
  logger?: (message: string, error?: unknown) => void;
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

    try {
      const repaired = buildMinimalKeyringMeta(entry);
      repairedMetas.push(repaired);
      reconciledMetas.push(repaired);
      metaIds.add(repaired.id);
    } catch (error) {
      logger?.(`keyring: failed to build minimal meta for ${entry.keyringId}`, error);
    }
  }

  return {
    reconciledMetas,
    reconciledAccounts,
    repairedMetas,
    prunedKeyringIds,
  };
};
