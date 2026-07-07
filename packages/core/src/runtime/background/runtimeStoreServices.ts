import type { Messenger } from "../../messenger/index.js";
import { createAccountsService } from "../../accounts/AccountsService.js";
import type { AccountsPort } from "../../accounts/accountsPort.js";
import { createChainRpcDefaultEndpointsService } from "../../chains/rpc/defaultEndpoints/ChainRpcDefaultEndpointsService.js";
import type { ChainRpcDefaultEndpointsPort } from "../../chains/rpc/defaultEndpoints/port.js";
import { createChainRpcEndpointOverridesService } from "../../chains/rpc/endpointOverrides/ChainRpcEndpointOverridesService.js";
import type { ChainRpcEndpointOverridesPort } from "../../chains/rpc/endpointOverrides/port.js";
import type { KeyringMetasPort } from "../../keyring/keyringMetasPort.js";
import type { PermissionsPort } from "../../permissions/service/port.js";
import { createProviderChainSelectionService } from "../../chains/selection/provider/ProviderChainSelectionService.js";
import type { ProviderChainSelectionPort } from "../../chains/selection/provider/port.js";
import type { WalletChainSelectionPort } from "../../chains/selection/wallet/port.js";
import { createWalletChainSelectionService } from "../../chains/selection/wallet/WalletChainSelectionService.js";
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
