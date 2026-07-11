import type { PermissionRecord } from "@arx/core/persistence";
import type { PermissionRow } from "../rows.js";

export const permissionToRow = (record: PermissionRecord): PermissionRow => ({
  ...record,
  indexedAccountIds: [...new Set(Object.values(record.chainScopes).flat())],
  indexedChainRefs: Object.keys(record.chainScopes),
});

export const permissionFromRow = ({
  indexedAccountIds: _indexedAccountIds,
  indexedChainRefs: _indexedChainRefs,
  ...record
}: PermissionRow): PermissionRecord => record;
