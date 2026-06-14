import { createAccountsService } from "../../services/store/accounts/AccountsService.js";
import type { AccountsPort } from "../../services/store/accounts/port.js";
import { createChainRpcDefaultEndpointsService } from "../../services/store/chainRpcDefaultEndpoints/ChainRpcDefaultEndpointsService.js";
import type { ChainRpcDefaultEndpointsPort } from "../../services/store/chainRpcDefaultEndpoints/port.js";
import { createChainRpcEndpointOverridesService } from "../../services/store/chainRpcEndpointOverrides/ChainRpcEndpointOverridesService.js";
import type { ChainRpcEndpointOverridesPort } from "../../services/store/chainRpcEndpointOverrides/port.js";
import { createKeyringMetasService } from "../../services/store/keyringMetas/KeyringMetasService.js";
import type { KeyringMetasPort } from "../../services/store/keyringMetas/port.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import { createProviderChainSelectionService } from "../../services/store/providerChainSelection/ProviderChainSelectionService.js";
import type { ProviderChainSelectionPort } from "../../services/store/providerChainSelection/port.js";
import type { SettingsPort } from "../../services/store/settings/port.js";
import { createSettingsService } from "../../services/store/settings/SettingsService.js";
import type { WalletChainSelectionPort } from "../../services/store/walletChainSelection/port.js";
import { createWalletChainSelectionService } from "../../services/store/walletChainSelection/WalletChainSelectionService.js";
import type { RuntimeWalletChainSelectionDefaults } from "./chainRpcDefaults.js";

export type RuntimeStorePorts = {
  accounts: AccountsPort;
  keyringMetas: KeyringMetasPort;
  permissions: PermissionsPort;
};

export type RuntimeStoreServices = {
  settingsService: ReturnType<typeof createSettingsService>;
  walletChainSelection: ReturnType<typeof createWalletChainSelectionService>;
  providerChainSelection: ReturnType<typeof createProviderChainSelectionService>;
  chainRpcDefaultEndpoints: ReturnType<typeof createChainRpcDefaultEndpointsService>;
  chainRpcEndpointOverrides: ReturnType<typeof createChainRpcEndpointOverridesService>;
  accountsStore: ReturnType<typeof createAccountsService>;
  keyringMetas: ReturnType<typeof createKeyringMetasService>;
};

export const initRuntimeStoreServices = ({
  settingsPort,
  walletChainSelectionPort,
  providerChainSelectionPort,
  chainRpcDefaultEndpointsPort,
  chainRpcEndpointOverridesPort,
  ports,
  selectionDefaults,
  now,
}: {
  settingsPort: SettingsPort;
  walletChainSelectionPort: WalletChainSelectionPort;
  providerChainSelectionPort: ProviderChainSelectionPort;
  chainRpcDefaultEndpointsPort: ChainRpcDefaultEndpointsPort;
  chainRpcEndpointOverridesPort: ChainRpcEndpointOverridesPort;
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
  const chainRpcDefaultEndpoints = createChainRpcDefaultEndpointsService({
    port: chainRpcDefaultEndpointsPort,
    now,
  });
  const chainRpcEndpointOverrides = createChainRpcEndpointOverridesService({
    port: chainRpcEndpointOverridesPort,
    now,
  });

  const accountsStore = createAccountsService({ port: ports.accounts });
  const keyringMetas = createKeyringMetasService({ port: ports.keyringMetas });

  return {
    settingsService,
    walletChainSelection,
    providerChainSelection,
    chainRpcDefaultEndpoints,
    chainRpcEndpointOverrides,
    accountsStore,
    keyringMetas,
  };
};
