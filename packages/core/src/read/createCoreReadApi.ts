import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import type { AccountRecord, KeyringMetaRecord } from "../storage/records.js";
import type { TransactionsService } from "../transactions/TransactionsService.js";
import type { UiAccountMeta, UiKeyringMeta, UiSnapshot } from "../ui/protocol/schemas.js";
import type { CoreReadApi, CoreReadUnsubscribe } from "./types.js";

type CoreReadStateSubscription = (listener: () => void) => CoreReadUnsubscribe;

export type CreateCoreReadApiInput = {
  getWalletSnapshot: () => UiSnapshot;
  listKeyringRecords: () => KeyringMetaRecord[];
  listAccountRecordsByKeyring: (input: { keyringId: string; includeHidden: boolean }) => AccountRecord[];
  getBackupStatus: CoreReadApi["getBackupStatus"];
  listPendingApprovals: CoreReadApi["listPendingApprovals"];
  getApprovalDetail: CoreReadApi["getApprovalDetail"];
  listTransactions: TransactionsService["listTransactions"];
  getTransactionDetail: TransactionsService["getTransaction"];
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  subscribeSources: readonly CoreReadStateSubscription[];
};

const buildKeyringMetaFromRecord = (record: KeyringMetaRecord): UiKeyringMeta => ({
  id: record.id,
  type: record.type,
  createdAt: record.createdAt,
  ...(record.alias !== undefined ? { alias: record.alias } : {}),
  ...(record.type === "hd"
    ? { backedUp: record.needsBackup !== true, derivedCount: record.nextDerivationIndex ?? 0 }
    : {}),
});

const buildAccountMetaFromRecord = (
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">,
  record: AccountRecord,
): UiAccountMeta => ({
  accountKey: record.accountKey,
  canonicalAddress: accountCodecs.toCanonicalAddressFromAccountKey({
    accountKey: record.accountKey,
  }),
  keyringId: record.keyringId,
  createdAt: record.createdAt,
  ...(record.derivationIndex !== undefined ? { derivationIndex: record.derivationIndex } : {}),
  ...(record.alias !== undefined ? { alias: record.alias } : {}),
  ...(record.hidden !== undefined ? { hidden: record.hidden } : {}),
});

const subscribeAfterInitialReplay = (subscribe: CoreReadStateSubscription, listener: () => void) => {
  let replayingSnapshot = true;
  const unsubscribe = subscribe(() => {
    if (replayingSnapshot) {
      return;
    }
    listener();
  });
  replayingSnapshot = false;
  return unsubscribe;
};

export const createCoreReadApi = (input: CreateCoreReadApiInput): CoreReadApi => ({
  getWalletSnapshot: input.getWalletSnapshot,
  listKeyrings: () => input.listKeyringRecords().map(buildKeyringMetaFromRecord),
  getAccountsByKeyring: ({ keyringId, includeHidden }) =>
    input
      .listAccountRecordsByKeyring({ keyringId, includeHidden: includeHidden ?? false })
      .map((record) => buildAccountMetaFromRecord(input.accountCodecs, record)),
  getBackupStatus: input.getBackupStatus,
  listPendingApprovals: input.listPendingApprovals,
  getApprovalDetail: input.getApprovalDetail,
  listTransactions: async (query) => await input.listTransactions(query),
  getTransactionDetail: async ({ transactionId }) => await input.getTransactionDetail(transactionId),
  subscribe: (listener) => {
    const unsubscribers = input.subscribeSources.map((subscribe) => subscribeAfterInitialReplay(subscribe, listener));
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  },
});
