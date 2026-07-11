import { getAccountIdNamespace } from "@arx/core/accounts";
import type { AccountRecord } from "@arx/core/persistence";
import type { AccountRow } from "../rows.js";

export const accountToRow = (record: AccountRecord): AccountRow => {
  if (record.origin.type === "hd") {
    return {
      ...record,
      namespace: getAccountIdNamespace(record.accountId),
      hdKeyringId: record.origin.keyringId,
    };
  }

  return {
    ...record,
    namespace: getAccountIdNamespace(record.accountId),
    privateKeySourceId: record.origin.keySourceId,
  };
};

export const accountFromRow = ({
  namespace: _namespace,
  hdKeyringId: _hdKeyringId,
  privateKeySourceId: _privateKeySourceId,
  ...record
}: AccountRow): AccountRecord => record;
