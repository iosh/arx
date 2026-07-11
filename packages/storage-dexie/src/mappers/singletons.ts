import type { EncryptedVaultRecord, WalletChainSelectionRecord } from "@arx/core/persistence";
import {
  ENCRYPTED_VAULT_ROW_KEY,
  type EncryptedVaultRow,
  WALLET_CHAIN_SELECTION_ROW_KEY,
  type WalletChainSelectionRow,
} from "../rows.js";

export const encryptedVaultToRow = (record: EncryptedVaultRecord): EncryptedVaultRow => ({
  ...record,
  key: ENCRYPTED_VAULT_ROW_KEY,
});

export const encryptedVaultFromRow = ({ key: _key, ...record }: EncryptedVaultRow): EncryptedVaultRecord => record;

export const walletChainSelectionToRow = (record: WalletChainSelectionRecord): WalletChainSelectionRow => ({
  ...record,
  key: WALLET_CHAIN_SELECTION_ROW_KEY,
});

export const walletChainSelectionFromRow = ({
  key: _key,
  ...record
}: WalletChainSelectionRow): WalletChainSelectionRecord => record;
