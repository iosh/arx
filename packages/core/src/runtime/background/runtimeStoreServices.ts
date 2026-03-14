import { createAccountsService } from "../../services/store/accounts/AccountsService.js";
import type { AccountsPort } from "../../services/store/accounts/port.js";
import { createKeyringMetasService } from "../../services/store/keyringMetas/KeyringMetasService.js";
import type { KeyringMetasPort } from "../../services/store/keyringMetas/port.js";
import { createNetworkPreferencesService } from "../../services/store/networkPreferences/NetworkPreferencesService.js";
import type { NetworkPreferencesPort } from "../../services/store/networkPreferences/port.js";
import { createPermissionsService } from "../../services/store/permissions/PermissionsService.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import type { SettingsPort } from "../../services/store/settings/port.js";
import { createSettingsService } from "../../services/store/settings/SettingsService.js";
import type { TransactionsPort } from "../../services/store/transactions/port.js";
import { createTransactionsService } from "../../services/store/transactions/TransactionsService.js";
import { DEFAULT_CHAIN } from "./constants.js";

export type RuntimeStorePorts = {
  transactions: TransactionsPort;
  accounts: AccountsPort;
  keyringMetas: KeyringMetasPort;
  permissions: PermissionsPort;
};

export type RuntimeStoreServices = {
  settingsService: ReturnType<typeof createSettingsService>;
  networkPreferences: ReturnType<typeof createNetworkPreferencesService>;
  transactionsService: ReturnType<typeof createTransactionsService>;
  permissionsService: ReturnType<typeof createPermissionsService>;
  accountsStore: ReturnType<typeof createAccountsService>;
  keyringMetas: ReturnType<typeof createKeyringMetasService>;
};

export const initRuntimeStoreServices = ({
  settingsPort,
  networkPreferencesPort,
  ports,
  now,
}: {
  settingsPort: SettingsPort;
  networkPreferencesPort: NetworkPreferencesPort;
  ports: RuntimeStorePorts;
  now: () => number;
}): RuntimeStoreServices => {
  const settingsService = createSettingsService({ port: settingsPort, now });

  const networkPreferences = createNetworkPreferencesService({
    port: networkPreferencesPort,
    defaults: {
      selectedChainRef: DEFAULT_CHAIN.chainRef,
      activeChainByNamespace: { [DEFAULT_CHAIN.namespace]: DEFAULT_CHAIN.chainRef },
    },
    now,
  });

  const transactionsService = createTransactionsService({
    port: ports.transactions,
    now,
  });

  const permissionsService = createPermissionsService({
    port: ports.permissions,
    now,
  });

  const accountsStore = createAccountsService({ port: ports.accounts });
  const keyringMetas = createKeyringMetasService({ port: ports.keyringMetas });

  return {
    settingsService,
    networkPreferences,
    transactionsService,
    permissionsService,
    accountsStore,
    keyringMetas,
  };
};
