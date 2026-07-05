import type { AccountAddressingByNamespace } from "../../accounts/addressing/addressing.js";
import { StoreAccountSelectionService } from "../../accounts/runtime/StoreAccountSelectionService.js";
import type { AccountSelectionService } from "../../accounts/runtime/types.js";
import { InMemoryApprovalQueueService } from "../../approvals/queue/InMemoryApprovalQueueService.js";
import type { ApprovalQueueService } from "../../approvals/queue/types.js";
import type { ChainDefinitionSeed, RpcEndpoint } from "../../chains/definition.js";
import { ChainRpcService } from "../../chains/rpc/ChainRpcService.js";
import type { ChainRpcAccessUpdater, ChainRpcReader } from "../../chains/rpc/types.js";
import { InMemoryChainDefinitionsService } from "../../chains/runtime/chainDefinitions/ChainDefinitionsService.js";
import type { ChainDefinitionsService } from "../../chains/runtime/chainDefinitions/types.js";
import type { Messenger } from "../../messenger/index.js";
import { PermissionsService } from "../../permissions/service/PermissionsService.js";
import type { PermissionsEvents, PermissionsReader, PermissionsWriter } from "../../permissions/service/types.js";
import type { AccountsService } from "../../services/store/accounts/types.js";
import type { ChainDefinitionsPort } from "../../services/store/chainDefinitions/port.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";

export type BackgroundStateServiceOptions = {
  approvals?: {
    autoRejectMessage?: string;
    ttlMs?: number;
    logger?: (message: string, error?: unknown) => void;
  };
  chainDefinitions: {
    port: ChainDefinitionsPort;
    seed?: ChainDefinitionSeed<RpcEndpoint>[];
    now?: () => number;
    logger?: (message: string, error?: unknown) => void;
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
    ...(approvalOptions?.logger !== undefined ? { logger: approvalOptions.logger } : {}),
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
    ...(chainDefinitionsOptions.now ? { now: chainDefinitionsOptions.now } : {}),
    ...(chainDefinitionsOptions.logger ? { logger: chainDefinitionsOptions.logger } : {}),
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
