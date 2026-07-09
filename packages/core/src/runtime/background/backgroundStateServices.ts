import type { AccountsService } from "../../accounts/accountsTypes.js";
import type { AccountAddressingByNamespace } from "../../accounts/addressing/addressing.js";
import { StoreAccountSelectionService } from "../../accounts/selection/StoreAccountSelectionService.js";
import type { AccountSelectionService } from "../../accounts/selection/types.js";
import { InMemoryApprovalQueueService } from "../../approvals/queue/InMemoryApprovalQueueService.js";
import type { ApprovalQueueService } from "../../approvals/queue/types.js";
import type { ChainDefinitionSeed, RpcEndpoint } from "../../chains/definition.js";
import { InMemoryChainDefinitionsService } from "../../chains/definitions/ChainDefinitionsService.js";
import type { ChainDefinitionsPort } from "../../chains/definitions/port.js";
import type { ChainDefinitionsService } from "../../chains/definitions/types.js";
import { ChainRpcService } from "../../chains/rpc/ChainRpcService.js";
import type { ChainRpcAccessUpdater, ChainRpcReader } from "../../chains/rpc/types.js";
import type { Messenger } from "../../messenger/index.js";
import { PermissionsService } from "../../permissions/service/PermissionsService.js";
import type { PermissionsPort } from "../../permissions/service/port.js";
import type { PermissionsEvents, PermissionsReader, PermissionsWriter } from "../../permissions/service/types.js";

export type BackgroundStateServiceOptions = {
  approvals?: {
    autoRejectMessage?: string;
    ttlMs?: number;
  };
  chainDefinitions: {
    port: ChainDefinitionsPort;
    seed?: ChainDefinitionSeed<RpcEndpoint>[];
  };
};

export type BackgroundStateServices = {
  chainRpc: ChainRpcReader;
  accounts: AccountSelectionService;
  approvals: ApprovalQueueService;
  permissions: PermissionsReader & PermissionsWriter & PermissionsEvents;
  chainDefinitions: ChainDefinitionsService;
};

export type BackgroundStateServicesInitResult = {
  stateServices: BackgroundStateServices;
  chainRpcAccessUpdater: ChainRpcAccessUpdater;
  chainDefinitionsService: ChainDefinitionsService;
  permissionsService: PermissionsService;
  permissionsReady: Promise<void>;
};

export const initBackgroundStateServices = ({
  messenger,
  accountAddressing,
  accountsService,
  permissionsPort,
  options,
}: {
  messenger: Messenger;
  accountAddressing: AccountAddressingByNamespace;
  accountsService: AccountsService;
  permissionsPort: PermissionsPort;
  options: BackgroundStateServiceOptions;
}): BackgroundStateServicesInitResult => {
  const { approvals: approvalOptions, chainDefinitions: chainDefinitionsOptions } = options;

  const chainDefinitionSeed = (chainDefinitionsOptions.seed ?? []).map((seed) => seed.definition);

  const chainRpcService = new ChainRpcService({
    messenger,
    initialAccesses: [],
  });

  const accountSelectionService: AccountSelectionService = new StoreAccountSelectionService({
    messenger,
    accounts: accountsService,
    accountAddressing,
  });

  const approvalQueueService = new InMemoryApprovalQueueService({
    messenger,
    ...(approvalOptions?.autoRejectMessage !== undefined
      ? { autoRejectMessage: approvalOptions.autoRejectMessage }
      : {}),
    ...(approvalOptions?.ttlMs !== undefined ? { ttlMs: approvalOptions.ttlMs } : {}),
  });

  const permissionsService = new PermissionsService({
    messenger,
    port: permissionsPort,
  });
  const permissionsReady = permissionsService.waitForHydration();

  const chainDefinitionsService = new InMemoryChainDefinitionsService({
    messenger,
    port: chainDefinitionsOptions.port,
    seed: chainDefinitionSeed,
  });
  const stateServices: BackgroundStateServices = {
    chainRpc: chainRpcService,
    accounts: accountSelectionService,
    approvals: approvalQueueService,
    permissions: permissionsService,
    chainDefinitions: chainDefinitionsService,
  };

  return {
    stateServices,
    chainRpcAccessUpdater: chainRpcService,
    chainDefinitionsService,
    permissionsService,
    permissionsReady,
  };
};
