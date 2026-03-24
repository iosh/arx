import { ArxReasons, arxError } from "@arx/errors";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import type { SessionStatusService } from "./sessionStatus.js";

export type KeyringExportService = {
  exportMnemonic(keyringId: string, password: string): Promise<string>;
  exportPrivateKeyByAccountKey(accountKey: string, password: string): Promise<Uint8Array>;
};

type CreateKeyringExportServiceDeps = {
  sessionStatus: Pick<SessionStatusService, "isUnlocked">;
  keyring: Pick<KeyringService, "exportMnemonic" | "exportPrivateKeyByAccountKey">;
};

const assertSessionUnlocked = (sessionStatus: Pick<SessionStatusService, "isUnlocked">) => {
  if (!sessionStatus.isUnlocked()) {
    throw arxError({
      reason: ArxReasons.SessionLocked,
      message: "Wallet is locked",
    });
  }
};

export const createKeyringExportService = ({
  sessionStatus,
  keyring,
}: CreateKeyringExportServiceDeps): KeyringExportService => {
  return {
    exportMnemonic: async (keyringId, password) => {
      assertSessionUnlocked(sessionStatus);
      return await keyring.exportMnemonic(keyringId, password);
    },
    exportPrivateKeyByAccountKey: async (accountKey, password) => {
      assertSessionUnlocked(sessionStatus);
      return await keyring.exportPrivateKeyByAccountKey(accountKey, password);
    },
  };
};
