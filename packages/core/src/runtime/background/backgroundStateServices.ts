import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import { StoreAccountSelectionService } from "../../accounts/runtime/StoreAccountSelectionService.js";
import { ACCOUNTS_TOPICS } from "../../accounts/runtime/topics.js";
import type { AccountSelectionService } from "../../accounts/runtime/types.js";
import { InMemoryApprovalQueueService } from "../../approvals/queue/InMemoryApprovalQueueService.js";
import { APPROVAL_TOPICS } from "../../approvals/queue/topics.js";
import type { ApprovalQueueService } from "../../approvals/queue/types.js";
import type { ApprovalExecutor } from "../../approvals/types.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import { ChainRpcService } from "../../chains/rpc/ChainRpcService.js";
import { CHAIN_RPC_TOPICS } from "../../chains/rpc/topics.js";
import type { ChainRpcAccessUpdater, ChainRpcReader } from "../../chains/rpc/types.js";
import { InMemoryChainDefinitionsService } from "../../chains/runtime/chainDefinitions/ChainDefinitionsService.js";
import { CHAIN_DEFINITIONS_TOPICS } from "../../chains/runtime/chainDefinitions/topics.js";
import type { ChainDefinitionsService } from "../../chains/runtime/chainDefinitions/types.js";
import { InMemorySupportedChainsService } from "../../chains/runtime/supportedChains/SupportedChainsService.js";
import type { SupportedChainsService } from "../../chains/runtime/supportedChains/types.js";
import type { Messenger } from "../../messenger/Messenger.js";
import { PermissionsService } from "../../permissions/service/PermissionsService.js";
import { PERMISSION_TOPICS } from "../../permissions/service/topics.js";
import type { PermissionsEvents, PermissionsReader, PermissionsWriter } from "../../permissions/service/types.js";
import type { AccountsService } from "../../services/store/accounts/types.js";
import type { ChainDefinitionsPort } from "../../services/store/chainDefinitions/port.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import type { SettingsService } from "../../services/store/settings/types.js";

export type BackgroundStateServiceOptions = {
  approvals?: {
    autoRejectMessage?: string;
    ttlMs?: number;
    logger?: (message: string, error?: unknown) => void;
  };
  supportedChains?: {
    port: ChainDefinitionsPort;
    seed?: ChainMetadata[];
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
  supportedChains: SupportedChainsService;
};

export type BackgroundStateServicesInitResult = {
  stateServices: BackgroundStateServices;
  chainRpcAccessUpdater: ChainRpcAccessUpdater;
  chainDefinitionsService: ChainDefinitionsService;
  supportedChainsService: SupportedChainsService;
  permissionsService: PermissionsService;
  permissionsReady: Promise<void>;
  setApprovalExecutor(executor: ApprovalExecutor | undefined): void;
};

export const initBackgroundStateServices = ({
  bus,
  accountCodecs,
  accountsService,
  settingsService,
  permissionsPort,
  options,
}: {
  bus: Messenger;
  accountCodecs: AccountCodecRegistry;
  accountsService: AccountsService;
  settingsService: SettingsService;
  permissionsPort: PermissionsPort;
  options: BackgroundStateServiceOptions;
}): BackgroundStateServicesInitResult => {
  const { approvals: approvalOptions, supportedChains: supportedChainsOptions } = options;

  if (!supportedChainsOptions?.port) {
    throw new Error("createBackgroundRuntime requires chainDefinitions port");
  }

  const supportedChainSeed: ChainMetadata[] = (supportedChainsOptions.seed ?? []).map((entry) => ({ ...entry }));

  const chainRpcService = new ChainRpcService({
    messenger: bus.scope({ name: "chainRpc", publish: CHAIN_RPC_TOPICS }),
    initialAccesses: [],
  });

  const accountSelectionService: AccountSelectionService = new StoreAccountSelectionService({
    messenger: bus.scope({ name: "accounts", publish: ACCOUNTS_TOPICS }),
    accounts: accountsService,
    settings: settingsService,
    accountCodecs,
  });

  let approvalExecutor: ApprovalExecutor | undefined;

  const approvalQueueService = new InMemoryApprovalQueueService({
    messenger: bus.scope({ name: "approvals", publish: APPROVAL_TOPICS }),
    ...(approvalOptions?.autoRejectMessage !== undefined
      ? { autoRejectMessage: approvalOptions.autoRejectMessage }
      : {}),
    ...(approvalOptions?.ttlMs !== undefined ? { ttlMs: approvalOptions.ttlMs } : {}),
    ...(approvalOptions?.logger !== undefined ? { logger: approvalOptions.logger } : {}),
    getExecutor: () => approvalExecutor,
  });

  const permissionsService = new PermissionsService({
    messenger: bus.scope({ name: "permissions", publish: PERMISSION_TOPICS }),
    port: permissionsPort,
  });
  const permissionsReady = permissionsService.waitForHydration();

  const chainDefinitionsService = new InMemoryChainDefinitionsService({
    messenger: bus.scope({ name: "chainDefinitions", publish: CHAIN_DEFINITIONS_TOPICS }),
    port: supportedChainsOptions.port,
    seed: supportedChainSeed,
    ...(supportedChainsOptions.now ? { now: supportedChainsOptions.now } : {}),
    ...(supportedChainsOptions.logger ? { logger: supportedChainsOptions.logger } : {}),
  });
  const supportedChainsService = new InMemorySupportedChainsService({
    chainDefinitions: chainDefinitionsService,
  });

  const stateServices: BackgroundStateServices = {
    chainRpc: chainRpcService,
    accounts: accountSelectionService,
    approvals: approvalQueueService,
    permissions: permissionsService,
    chainDefinitions: chainDefinitionsService,
    supportedChains: supportedChainsService,
  };

  return {
    stateServices,
    chainRpcAccessUpdater: chainRpcService,
    chainDefinitionsService,
    supportedChainsService,
    permissionsService,
    permissionsReady,
    setApprovalExecutor(executor) {
      approvalExecutor = executor;
    },
  };
};
