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
import { assertNonEmptyRpcEndpoints } from "../../chains/rpc/config.js";
import { CHAIN_RPC_TOPICS } from "../../chains/rpc/topics.js";
import type { ChainRpcAccess, ChainRpcAccessUpdater, ChainRpcReader } from "../../chains/rpc/types.js";
import { InMemorySupportedChainsService } from "../../chains/runtime/supportedChains/SupportedChainsService.js";
import { SUPPORTED_CHAINS_TOPICS } from "../../chains/runtime/supportedChains/topics.js";
import type { SupportedChainsService } from "../../chains/runtime/supportedChains/types.js";
import type { Messenger } from "../../messenger/Messenger.js";
import { PermissionsService } from "../../permissions/service/PermissionsService.js";
import { PERMISSION_TOPICS } from "../../permissions/service/topics.js";
import type { PermissionsEvents, PermissionsReader, PermissionsWriter } from "../../permissions/service/types.js";
import type { AccountsService } from "../../services/store/accounts/types.js";
import type { CustomChainsPort } from "../../services/store/customChains/port.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import type { SettingsService } from "../../services/store/settings/types.js";
import type { RuntimeChainAdmission } from "./chainRpcDefaults.js";

export type BackgroundStateServiceOptions = {
  approvals?: {
    autoRejectMessage?: string;
    ttlMs?: number;
    logger?: (message: string, error?: unknown) => void;
  };
  supportedChains?: {
    port: CustomChainsPort;
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
  supportedChains: SupportedChainsService;
};

export type BackgroundStateServicesInitResult = {
  stateServices: BackgroundStateServices;
  chainRpcAccessUpdater: ChainRpcAccessUpdater;
  supportedChainsService: SupportedChainsService;
  permissionsService: PermissionsService;
  permissionsReady: Promise<void>;
  setApprovalExecutor(executor: ApprovalExecutor | undefined): void;
};

const buildInitialRpcAccesses = (chains: readonly ChainMetadata[]): ChainRpcAccess[] =>
  chains.map((chain) => ({
    chainRef: chain.chainRef,
    endpoints: assertNonEmptyRpcEndpoints(chain.chainRef, chain.rpcEndpoints),
  }));

export const initBackgroundStateServices = ({
  bus,
  accountCodecs,
  accountsService,
  settingsService,
  permissionsPort,
  chainAdmission,
  options,
}: {
  bus: Messenger;
  accountCodecs: AccountCodecRegistry;
  accountsService: AccountsService;
  settingsService: SettingsService;
  permissionsPort: PermissionsPort;
  chainAdmission: RuntimeChainAdmission;
  options: BackgroundStateServiceOptions;
}): BackgroundStateServicesInitResult => {
  const { approvals: approvalOptions, supportedChains: supportedChainsOptions } = options;

  if (!supportedChainsOptions?.port) {
    throw new Error("createBackgroundRuntime requires supportedChains.port");
  }

  const supportedChainSeed: ChainMetadata[] = (supportedChainsOptions.seed ?? []).map((entry) => ({ ...entry }));

  const chainRpcService = new ChainRpcService({
    messenger: bus.scope({ name: "chainRpc", publish: CHAIN_RPC_TOPICS }),
    initialAccesses: buildInitialRpcAccesses(chainAdmission.admittedChains),
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

  const supportedChainsService = new InMemorySupportedChainsService({
    messenger: bus.scope({ name: "supportedChains", publish: SUPPORTED_CHAINS_TOPICS }),
    port: supportedChainsOptions.port,
    seed: supportedChainSeed,
    ...(supportedChainsOptions.now ? { now: supportedChainsOptions.now } : {}),
    ...(supportedChainsOptions.logger ? { logger: supportedChainsOptions.logger } : {}),
  });

  const stateServices: BackgroundStateServices = {
    chainRpc: chainRpcService,
    accounts: accountSelectionService,
    approvals: approvalQueueService,
    permissions: permissionsService,
    supportedChains: supportedChainsService,
  };

  return {
    stateServices,
    chainRpcAccessUpdater: chainRpcService,
    supportedChainsService,
    permissionsService,
    permissionsReady,
    setApprovalExecutor(executor) {
      approvalExecutor = executor;
    },
  };
};
