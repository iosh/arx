import { createAccountsService } from "../../services/store/accounts/AccountsService.js";
import type { AccountsPort } from "../../services/store/accounts/port.js";
import { createCustomRpcService } from "../../services/store/customRpc/CustomRpcService.js";
import type { CustomRpcPort } from "../../services/store/customRpc/port.js";
import { createKeyringMetasService } from "../../services/store/keyringMetas/KeyringMetasService.js";
import type { KeyringMetasPort } from "../../services/store/keyringMetas/port.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import { createProviderChainSelectionService } from "../../services/store/providerChainSelection/ProviderChainSelectionService.js";
import type { ProviderChainSelectionPort } from "../../services/store/providerChainSelection/port.js";
import type { SettingsPort } from "../../services/store/settings/port.js";
import { createSettingsService } from "../../services/store/settings/SettingsService.js";
import type { WalletChainSelectionPort } from "../../services/store/walletChainSelection/port.js";
import { createWalletChainSelectionService } from "../../services/store/walletChainSelection/WalletChainSelectionService.js";
import type { RuntimeWalletChainSelectionDefaults } from "./networkDefaults.js";

export type RuntimeStorePorts = {
  accounts: AccountsPort;
  keyringMetas: KeyringMetasPort;
  permissions: PermissionsPort;
};

export type RuntimeStoreServices = {
  settingsService: ReturnType<typeof createSettingsService>;
  walletChainSelection: ReturnType<typeof createWalletChainSelectionService>;
  providerChainSelection: ReturnType<typeof createProviderChainSelectionService>;
  customRpc: ReturnType<typeof createCustomRpcService>;
  accountsStore: ReturnType<typeof createAccountsService>;
  keyringMetas: ReturnType<typeof createKeyringMetasService>;
};

export const initRuntimeStoreServices = ({
  settingsPort,
  walletChainSelectionPort,
  providerChainSelectionPort,
  customRpcPort,
  ports,
  selectionDefaults,
  now,
}: {
  settingsPort: SettingsPort;
  walletChainSelectionPort: WalletChainSelectionPort;
  providerChainSelectionPort: ProviderChainSelectionPort;
  customRpcPort: CustomRpcPort;
  ports: RuntimeStorePorts;
  selectionDefaults: RuntimeWalletChainSelectionDefaults;
  now: () => number;
}): RuntimeStoreServices => {
  const settingsService = createSettingsService({ port: settingsPort, now });

  const walletChainSelection = createWalletChainSelectionService({
    port: walletChainSelectionPort,
    defaults: selectionDefaults,
    now,
  });
  const providerChainSelection = createProviderChainSelectionService({
    port: providerChainSelectionPort,
    now,
  });
  const customRpc = createCustomRpcService({ port: customRpcPort, now });

  const accountsStore = createAccountsService({ port: ports.accounts });
  const keyringMetas = createKeyringMetasService({ port: ports.keyringMetas });

  return {
    settingsService,
    walletChainSelection,
    providerChainSelection,
    customRpc,
    accountsStore,
    keyringMetas,
  };
};
