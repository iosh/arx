import { describe, expect, it, vi } from "vitest";
import { toAccountKeyFromAddress } from "../accounts/addressing/accountKey.js";
import {
  MemoryAccountsPort,
  MemoryCustomChainsPort,
  MemoryCustomRpcPort,
  MemoryKeyringMetasPort,
  MemoryNetworkSelectionPort,
  MemoryPermissionsPort,
  MemorySettingsPort,
  MemoryTransactionAggregatesPort,
  MemoryVaultMetaPort,
  TEST_ACCOUNT_CODECS,
  TEST_MNEMONIC,
} from "../runtime/__fixtures__/backgroundTestSetup.js";
import type { TransactionAggregate } from "../transactions/storage/index.js";
import type { CreateCoreRuntimeInput } from "./coreRuntime.js";
import { createCoreRuntime } from "./createCoreRuntime.js";
import { createEip155WalletNamespaceModule } from "./modules/eip155.js";

const PASSWORD = "secret-pass";
const ORIGIN = "https://dapp.example";
const EIP155_NAMESPACE = "eip155";
const EIP155_CHAIN_REF = "eip155:1" as const;
const ACCOUNT_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const ACCOUNT_KEY = toAccountKeyFromAddress({
  chainRef: EIP155_CHAIN_REF,
  address: ACCOUNT_ADDRESS,
  accountCodecs: TEST_ACCOUNT_CODECS,
});

const createCoreRuntimeInput = (params?: {
  accountsPort?: MemoryAccountsPort;
  permissionsPort?: MemoryPermissionsPort;
  transactionAggregatesPort?: MemoryTransactionAggregatesPort;
  boot?: CreateCoreRuntimeInput["boot"];
}): CreateCoreRuntimeInput => ({
  namespaces: {
    modules: [createEip155WalletNamespaceModule()],
  },
  storage: {
    vault: new MemoryVaultMetaPort(),
    keyrings: new MemoryKeyringMetasPort(),
    accounts: params?.accountsPort ?? new MemoryAccountsPort(),
    permissions: params?.permissionsPort ?? new MemoryPermissionsPort(),
    chains: {
      customChains: new MemoryCustomChainsPort(),
      customRpc: new MemoryCustomRpcPort(),
      networkSelection: new MemoryNetworkSelectionPort(),
    },
    transactions: params?.transactionAggregatesPort ?? new MemoryTransactionAggregatesPort(),
    settings: new MemorySettingsPort({ id: "settings", updatedAt: 0 }),
  },
  ...(params?.boot ? { boot: params.boot } : {}),
});

const createSeededAccountsPort = () =>
  new MemoryAccountsPort([
    {
      accountKey: ACCOUNT_KEY,
      namespace: EIP155_NAMESPACE,
      keyringId: "11111111-1111-4111-8111-111111111111",
      createdAt: 1,
    },
  ]);

const createSeededPermissionsPort = () =>
  new MemoryPermissionsPort([
    {
      origin: ORIGIN,
      namespace: EIP155_NAMESPACE,
      chainScopes: {
        [EIP155_CHAIN_REF]: [ACCOUNT_KEY],
      },
    },
  ]);

const createRecoverableTransactionAggregate = (status: "awaiting_approval" | "submitting"): TransactionAggregate => ({
  record: {
    id: `tx-${status}`,
    namespace: EIP155_NAMESPACE,
    chainRef: EIP155_CHAIN_REF,
    origin: ORIGIN,
    source: "dapp",
    requestId: "request-1",
    accountKey: ACCOUNT_KEY,
    status,
    request: {
      kind: "eip155.rpc.eth_sendTransaction",
      payload: {
        from: ACCOUNT_ADDRESS,
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "0x1",
        data: "0x",
      },
    },
    approvedRequest: null,
    activeSubmissionId: status === "submitting" ? "submission-1" : null,
    submitted: null,
    receipt: null,
    conflictKey: null,
    replacesTransactionId: null,
    replacementType: null,
    replacedByTransactionId: null,
    terminalReason: null,
    createdAt: 1,
    updatedAt: 1,
  },
  submissions:
    status === "submitting"
      ? [
          {
            id: "submission-1",
            transactionId: "tx-submitting",
            status: "queued",
            terminalReason: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ]
      : [],
});

describe("createCoreRuntime", () => {
  it("returns a ready core runtime with only provider, ui, and read surfaces", async () => {
    const core = await createCoreRuntime(createCoreRuntimeInput());

    expect(Object.keys(core).sort()).toEqual(["provider", "read", "ui"]);
    expect(core.read.getWalletSnapshot()).toMatchObject({
      vault: { initialized: false },
      session: { isUnlocked: false },
      networks: { selectedNamespace: EIP155_NAMESPACE },
    });
    expect(core.provider.buildSnapshot(EIP155_NAMESPACE)).toMatchObject({
      namespace: EIP155_NAMESPACE,
      chain: { chainRef: EIP155_CHAIN_REF },
      isUnlocked: false,
    });
  });

  it("exposes typed wallet UI methods without raw UI dispatch", async () => {
    const core = await createCoreRuntime(createCoreRuntimeInput());

    expect("dispatch" in core.ui).toBe(false);
    await expect(core.ui.wallet.generateMnemonic()).resolves.toMatchObject({
      words: expect.arrayContaining([expect.any(String)]),
    });
    await expect(
      core.ui.wallet.createWalletFromMnemonic({
        password: PASSWORD,
        words: TEST_MNEMONIC.split(" "),
      }),
    ).resolves.toMatchObject({
      keyringId: expect.any(String),
      address: expect.stringMatching(/^0x[0-9a-f]+$/i),
    });
    expect(core.read.getWalletSnapshot()).toMatchObject({
      vault: { initialized: true },
      accounts: { totalCount: 1 },
    });
  });

  it("emits read invalidation when wallet state changes", async () => {
    const core = await createCoreRuntime(createCoreRuntimeInput());
    const listener = vi.fn();
    const unsubscribe = core.read.subscribe(listener);

    await core.ui.wallet.createWalletFromMnemonic({
      password: PASSWORD,
      words: TEST_MNEMONIC.split(" "),
    });

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("returns provider connection state from the read surface", async () => {
    const core = await createCoreRuntime(
      createCoreRuntimeInput({
        accountsPort: createSeededAccountsPort(),
        permissionsPort: createSeededPermissionsPort(),
      }),
    );

    expect(core.read.getProviderConnectionState({ origin: ORIGIN, namespace: EIP155_NAMESPACE })).toMatchObject({
      snapshot: {
        namespace: EIP155_NAMESPACE,
        chain: { chainRef: EIP155_CHAIN_REF },
      },
      accounts: [],
    });
  });

  it("runs transaction restart recovery by default and can skip it explicitly", async () => {
    const runPort = new MemoryTransactionAggregatesPort();
    await runPort.insertTransactionAggregate(createRecoverableTransactionAggregate("awaiting_approval"));
    await createCoreRuntime(
      createCoreRuntimeInput({
        transactionAggregatesPort: runPort,
      }),
    );
    await expect(runPort.loadTransactionAggregate("tx-awaiting_approval")).resolves.toMatchObject({
      record: {
        status: "cancelled",
        terminalReason: {
          code: "recovery.awaiting_approval_abandoned",
        },
      },
    });

    const skipPort = new MemoryTransactionAggregatesPort();
    await skipPort.insertTransactionAggregate(createRecoverableTransactionAggregate("submitting"));
    await createCoreRuntime(
      createCoreRuntimeInput({
        transactionAggregatesPort: skipPort,
        boot: { transactionRestartRecovery: "skip" },
      }),
    );
    await expect(skipPort.loadTransactionAggregate("tx-submitting")).resolves.toMatchObject({
      record: {
        status: "submitting",
        terminalReason: null,
      },
    });
  });
});
