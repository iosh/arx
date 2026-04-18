import { createAccountsService } from "../../services/store/accounts/AccountsService.js";
import type { AccountsPort } from "../../services/store/accounts/port.js";
import { createCustomRpcService } from "../../services/store/customRpc/CustomRpcService.js";
import type { CustomRpcPort } from "../../services/store/customRpc/port.js";
import { createKeyringMetasService } from "../../services/store/keyringMetas/KeyringMetasService.js";
import type { KeyringMetasPort } from "../../services/store/keyringMetas/port.js";
import { createNetworkSelectionService } from "../../services/store/networkSelection/NetworkSelectionService.js";
import type { NetworkSelectionPort } from "../../services/store/networkSelection/port.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import type { SettingsPort } from "../../services/store/settings/port.js";
import { createSettingsService } from "../../services/store/settings/SettingsService.js";
import type { TransactionsPort } from "../../services/store/transactions/port.js";
import { createTransactionsService } from "../../services/store/transactions/TransactionsService.js";
import type { RuntimeNetworkSelectionDefaults } from "./networkDefaults.js";

export type RuntimeStorePorts = {
  transactions: TransactionsPort;
  accounts: AccountsPort;
  keyringMetas: KeyringMetasPort;
  permissions: PermissionsPort;
};

export type RuntimeStoreServices = {
  settingsService: ReturnType<typeof createSettingsService>;
  networkSelection: ReturnType<typeof createNetworkSelectionService>;
  customRpc: ReturnType<typeof createCustomRpcService>;
  transactionsService: ReturnType<typeof createTransactionsService>;
  accountsStore: ReturnType<typeof createAccountsService>;
  keyringMetas: ReturnType<typeof createKeyringMetasService>;
};

export const initRuntimeStoreServices = ({
  settingsPort,
  networkSelectionPort,
  customRpcPort,
  ports,
  selectionDefaults,
  now,
}: {
  settingsPort: SettingsPort;
  networkSelectionPort: NetworkSelectionPort;
  customRpcPort: CustomRpcPort;
  ports: RuntimeStorePorts;
  selectionDefaults: RuntimeNetworkSelectionDefaults;
  now: () => number;
}): RuntimeStoreServices => {
  const settingsService = createSettingsService({ port: settingsPort, now });

  const networkSelection = createNetworkSelectionService({
    port: networkSelectionPort,
    defaults: selectionDefaults,
    now,
  });
  const customRpc = createCustomRpcService({ port: customRpcPort, now });

  const transactionsService = createTransactionsService({
    port: ports.transactions,
    now,
  });

  const accountsStore = createAccountsService({ port: ports.accounts });
  const keyringMetas = createKeyringMetasService({ port: ports.keyringMetas });

  return {
    settingsService,
    networkSelection,
    customRpc,
    transactionsService,
    accountsStore,
    keyringMetas,
  };
};
