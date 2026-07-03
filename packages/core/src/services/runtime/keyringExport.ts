import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import { SessionLockedError } from "../../runtime/session/errors.js";
import type { SessionStatusService } from "./sessionStatus.js";

export type KeyringExportService = {
  exportMnemonic(keyringId: string, password: string): Promise<string>;
  exportPrivateKeyByAccountId(accountId: string, password: string): Promise<Uint8Array>;
};

type CreateKeyringExportServiceDeps = {
  sessionStatus: Pick<SessionStatusService, "isUnlocked">;
  keyring: Pick<KeyringService, "exportMnemonic" | "exportPrivateKeyByAccountId">;
};

const assertSessionUnlocked = (sessionStatus: Pick<SessionStatusService, "isUnlocked">) => {
  if (!sessionStatus.isUnlocked()) {
    throw new SessionLockedError();
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
    exportPrivateKeyByAccountId: async (accountId, password) => {
      assertSessionUnlocked(sessionStatus);
      return await keyring.exportPrivateKeyByAccountId(accountId, password);
    },
  };
};
