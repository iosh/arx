import type { Messenger } from "../../messenger/index.js";
import { createAccountsService } from "../../services/store/accounts/AccountsService.js";
import type { AccountsPort } from "../../services/store/accounts/port.js";
import { createChainRpcDefaultEndpointsService } from "../../services/store/chainRpcDefaultEndpoints/ChainRpcDefaultEndpointsService.js";
import type { ChainRpcDefaultEndpointsPort } from "../../services/store/chainRpcDefaultEndpoints/port.js";
import { createChainRpcEndpointOverridesService } from "../../services/store/chainRpcEndpointOverrides/ChainRpcEndpointOverridesService.js";
import type { ChainRpcEndpointOverridesPort } from "../../services/store/chainRpcEndpointOverrides/port.js";
import type { KeyringMetasPort } from "../../services/store/keyringMetas/port.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import { createProviderChainSelectionService } from "../../services/store/providerChainSelection/ProviderChainSelectionService.js";
import type { ProviderChainSelectionPort } from "../../services/store/providerChainSelection/port.js";
import type { WalletChainSelectionPort } from "../../services/store/walletChainSelection/port.js";
import { createWalletChainSelectionService } from "../../services/store/walletChainSelection/WalletChainSelectionService.js";
import type { RuntimeWalletChainSelectionDefaults } from "./chainRpcDefaults.js";

export type RuntimeStorePorts = {
  accounts: AccountsPort;
  keyringMetas: KeyringMetasPort;
  permissions: PermissionsPort;
};

export type RuntimeStoreServices = {
  walletChainSelection: ReturnType<typeof createWalletChainSelectionService>;
  providerChainSelection: ReturnType<typeof createProviderChainSelectionService>;
  chainRpcDefaultEndpoints: ReturnType<typeof createChainRpcDefaultEndpointsService>;
  chainRpcEndpointOverrides: ReturnType<typeof createChainRpcEndpointOverridesService>;
  accountsStore: ReturnType<typeof createAccountsService>;
  keyringMetas: KeyringMetasPort;
};

export const initRuntimeStoreServices = ({
  messenger,
  walletChainSelectionPort,
  providerChainSelectionPort,
  chainRpcDefaultEndpointsPort,
  chainRpcEndpointOverridesPort,
  ports,
  selectionDefaults,
  now,
}: {
  messenger: Messenger;
  walletChainSelectionPort: WalletChainSelectionPort;
  providerChainSelectionPort: ProviderChainSelectionPort;
  chainRpcDefaultEndpointsPort: ChainRpcDefaultEndpointsPort;
  chainRpcEndpointOverridesPort: ChainRpcEndpointOverridesPort;
  ports: RuntimeStorePorts;
  selectionDefaults: RuntimeWalletChainSelectionDefaults;
  now: () => number;
}): RuntimeStoreServices => {
  const walletChainSelection = createWalletChainSelectionService({
    messenger,
    port: walletChainSelectionPort,
    defaults: selectionDefaults,
    now,
  });
  const providerChainSelection = createProviderChainSelectionService({
    messenger,
    port: providerChainSelectionPort,
    now,
  });
  const chainRpcDefaultEndpoints = createChainRpcDefaultEndpointsService({
    messenger,
    port: chainRpcDefaultEndpointsPort,
    now,
  });
  const chainRpcEndpointOverrides = createChainRpcEndpointOverridesService({
    messenger,
    port: chainRpcEndpointOverridesPort,
    now,
  });

  const accountsStore = createAccountsService({ messenger, port: ports.accounts });

  return {
    walletChainSelection,
    providerChainSelection,
    chainRpcDefaultEndpoints,
    chainRpcEndpointOverrides,
    accountsStore,
    keyringMetas: ports.keyringMetas,
  };
};
