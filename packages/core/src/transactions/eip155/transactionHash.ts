import * as Hash from "ox/Hash";
import type { Hex } from "ox/Hex";
import type { Eip155PendingTransactionRecord } from "../persistence.js";

export const pendingTransactionHash = (record: Eip155PendingTransactionRecord): Hex =>
  record.hash ?? Hash.keccak256(record.recovery.rawTransaction);
