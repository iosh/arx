import { describe, expect, it, vi } from "vitest";
import { toAccountKeyFromAddress } from "../accounts/addressing/accountKey.js";
import {
  MemoryAccountsPort,
  MemoryChainDefinitionsPort,
  MemoryChainRpcDefaultEndpointsPort,
  MemoryChainRpcEndpointOverridesPort,
  MemoryKeyringMetasPort,
  MemoryPermissionsPort,
  MemoryProviderChainSelectionPort,
  MemorySettingsPort,
  MemoryTransactionAggregatesPort,
  MemoryVaultMetaPort,
  MemoryWalletChainSelectionPort,
  TEST_ACCOUNT_CODECS,
  TEST_MNEMONIC,
} from "../runtime/__fixtures__/backgroundTestSetup.js";
import type { VaultMetaSnapshot } from "../storage/index.js";
import type { WalletChainSelectionRecord } from "../storage/records.js";
import type { TransactionAggregate } from "../transactions/storage/index.js";
import type { CreateCoreRuntimeInput } from "./coreRuntime.js";
import { createCoreRuntime } from "./createCoreRuntime.js";
import { createEip155WalletNamespaceModule } from "./modules/eip155.js";

const PASSWORD = "secret-pass";
const ORIGIN = "https://dapp.example";
const EIP155_NAMESPACE = "eip155";
const EIP155_CHAIN_REF = "eip155:1" as const;
const ACCOUNT_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const PRIVATE_KEY = "1111111111111111111111111111111111111111111111111111111111111111";
const ACCOUNT_KEY = toAccountKeyFromAddress({
  chainRef: EIP155_CHAIN_REF,
  address: ACCOUNT_ADDRESS,
  accountCodecs: TEST_ACCOUNT_CODECS,
});
const HYDRATE_FAILURE = new Error("hydrate storage unavailable");
type TestCoreStoragePorts = CreateCoreRuntimeInput["storage"];

const createCoreRuntimeInput = (params?: {
  accountsPort?: TestCoreStoragePorts["accounts"];
  chainDefinitionsPort?: TestCoreStoragePorts["chains"]["chainDefinitions"];
  chainRpcDefaultEndpointsPort?: TestCoreStoragePorts["chains"]["chainRpcDefaultEndpoints"];
  chainRpcEndpointOverridesPort?: TestCoreStoragePorts["chains"]["chainRpcEndpointOverrides"];
  walletChainSelectionPort?: TestCoreStoragePorts["chains"]["walletChainSelection"];
  providerChainSelectionPort?: TestCoreStoragePorts["chains"]["providerChainSelection"];
  permissionsPort?: TestCoreStoragePorts["permissions"];
  transactionAggregatesPort?: TestCoreStoragePorts["transactions"];
  vaultMetaPort?: TestCoreStoragePorts["vault"];
  boot?: CreateCoreRuntimeInput["boot"];
}): CreateCoreRuntimeInput => ({
  namespaces: {
    modules: [createEip155WalletNamespaceModule()],
  },
  storage: {
    vault: params?.vaultMetaPort ?? new MemoryVaultMetaPort(),
    keyrings: new MemoryKeyringMetasPort(),
    accounts: params?.accountsPort ?? new MemoryAccountsPort(),
    permissions: params?.permissionsPort ?? new MemoryPermissionsPort(),
    chains: {
      chainDefinitions: params?.chainDefinitionsPort ?? new MemoryChainDefinitionsPort(),
      chainRpcDefaultEndpoints: params?.chainRpcDefaultEndpointsPort ?? new MemoryChainRpcDefaultEndpointsPort(),
      chainRpcEndpointOverrides: params?.chainRpcEndpointOverridesPort ?? new MemoryChainRpcEndpointOverridesPort(),
      walletChainSelection: params?.walletChainSelectionPort ?? new MemoryWalletChainSelectionPort(),
      providerChainSelection: params?.providerChainSelectionPort ?? new MemoryProviderChainSelectionPort(),
    },
    transactions: params?.transactionAggregatesPort ?? new MemoryTransactionAggregatesPort(),
    settings: new MemorySettingsPort({ id: "settings", updatedAt: 0 }),
  },
  ...(params?.boot ? { boot: params.boot } : {}),
});

class FailingVaultMetaPort extends MemoryVaultMetaPort {
  override async loadVaultMeta(): Promise<VaultMetaSnapshot | null> {
    throw HYDRATE_FAILURE;
  }
}

class FailingWalletChainSelectionPort extends MemoryWalletChainSelectionPort {
  override async get(): Promise<WalletChainSelectionRecord | null> {
    throw HYDRATE_FAILURE;
  }
}

class FailingTransactionAggregatesPort extends MemoryTransactionAggregatesPort {
  override async listRecoverableTransactionAggregates(): Promise<TransactionAggregate[]> {
    throw HYDRATE_FAILURE;
  }
}

const expectHydrationFailure = async (input: CreateCoreRuntimeInput, details: { owner: string; resource: string }) => {
  await expect(createCoreRuntime(input)).rejects.toMatchObject({
    code: "runtime.hydration_failed",
    details,
  });
};

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

const createRecoverableTransactionAggregate = (status: "submitting" | "submitted"): TransactionAggregate => ({
  record: {
    id: `tx-${status}`,
    namespace: EIP155_NAMESPACE,
    chainRef: EIP155_CHAIN_REF,
    origin: ORIGIN,
    source: "provider",
    requestId: "request-1",
    accountKey: ACCOUNT_KEY,
    status,
    request: {
      payload: {
        from: ACCOUNT_ADDRESS,
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "0x1",
        data: "0x",
      },
    },
    approvedRequest: {
      approvalId: "approval-1",
      payload: {
        chainId: "0x1",
        from: ACCOUNT_ADDRESS,
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "0x1",
        data: "0x",
        gas: "0x5208",
        nonce: "0x7",
      },
      approvedAt: 1,
    },
    activeSubmissionId: status === "submitting" ? "submission-1" : null,
    submitted:
      status === "submitted"
        ? {
            hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            nonce: "0x7",
          }
        : null,
    receipt: null,
    conflictKey: null,
    replacesTransactionId: null,
    replacementType: null,
    replacedByTransactionId: null,
    terminalReason: null,
    createdAt: 1,
    updatedAt: 1,
  },
  submissions: [
    {
      id: "submission-1",
      transactionId: `tx-${status}`,
      status: status === "submitting" ? "queued" : "accepted",
      terminalReason: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
});

describe("createCoreRuntime", () => {
  it("returns a ready core runtime with only provider and wallet surfaces", async () => {
    const core = await createCoreRuntime(createCoreRuntimeInput());

    expect(Object.keys(core).sort()).toEqual(["provider", "wallet"]);
    expect(core.wallet.snapshot.get()).toMatchObject({
      vault: { initialized: false },
      session: { isUnlocked: false },
      networks: { selectedNamespace: EIP155_NAMESPACE },
    });
    await expect(
      core.provider.activateConnectionScope({ origin: ORIGIN, namespace: EIP155_NAMESPACE }),
    ).resolves.toMatchObject({
      snapshot: {
        namespace: EIP155_NAMESPACE,
        chain: { chainRef: EIP155_CHAIN_REF },
        isUnlocked: false,
      },
    });
  });

  it("exposes typed wallet API methods without raw UI dispatch", async () => {
    const core = await createCoreRuntime(createCoreRuntimeInput());

    expect("dispatch" in core.wallet).toBe(false);
    await expect(core.wallet.onboarding.generateMnemonic()).resolves.toMatchObject({
      words: expect.arrayContaining([expect.any(String)]),
    });
    const created = await core.wallet.onboarding.createWalletFromMnemonic({
      password: PASSWORD,
      words: TEST_MNEMONIC.split(" "),
    });
    expect(created).toMatchObject({
      keyringId: expect.any(String),
      address: expect.stringMatching(/^0x[0-9a-f]+$/i),
    });
    await expect(core.wallet.keyrings.deriveAccount({ keyringId: created.keyringId })).resolves.toMatchObject({
      address: expect.stringMatching(/^0x[0-9a-f]+$/i),
    });
    const privateKeyImport = await core.wallet.keyrings.importPrivateKey({ privateKey: PRIVATE_KEY });
    expect(privateKeyImport).toMatchObject({
      keyringId: expect.any(String),
      account: { address: expect.stringMatching(/^0x[0-9a-f]+$/i) },
    });
    await expect(
      core.wallet.keyrings.exportPrivateKey({
        accountKey: toAccountKeyFromAddress({
          chainRef: EIP155_CHAIN_REF,
          address: privateKeyImport.account.address,
          accountCodecs: TEST_ACCOUNT_CODECS,
        }),
        password: PASSWORD,
      }),
    ).resolves.toEqual({ privateKey: PRIVATE_KEY });
    await expect(core.wallet.networks.select({ chainRef: EIP155_CHAIN_REF })).resolves.toMatchObject({
      chainRef: EIP155_CHAIN_REF,
      namespace: EIP155_NAMESPACE,
    });
    const accountKey = toAccountKeyFromAddress({
      chainRef: EIP155_CHAIN_REF,
      address: created.address,
      accountCodecs: TEST_ACCOUNT_CODECS,
    });
    await expect(core.wallet.accounts.switchActive({ chainRef: EIP155_CHAIN_REF, accountKey })).resolves.toMatchObject({
      accountKey,
      canonicalAddress: created.address,
    });
    expect(core.wallet.snapshot.get()).toMatchObject({
      vault: { initialized: true },
      accounts: { totalCount: 3 },
    });
    expect(core.wallet.keyrings.list()).toHaveLength(2);
    expect(core.wallet.keyrings.getBackupStatus()).toMatchObject({ pendingHdKeyringCount: 1 });
    expect(core.wallet.keyrings.getAccountsByKeyring({ keyringId: created.keyringId })).toHaveLength(2);
    await expect(core.wallet.approvals.listPending()).resolves.toEqual([]);
    await expect(core.wallet.approvals.getDetail({ approvalId: "missing" })).resolves.toBeNull();
    await expect(core.wallet.transactions.listHistory()).resolves.toEqual([]);
    await expect(core.wallet.transactions.getDetail({ transactionId: "missing" })).resolves.toBeNull();
  });

  it("runs session wallet API methods through wallet actions", async () => {
    const core = await createCoreRuntime(createCoreRuntimeInput());

    await core.wallet.onboarding.createWalletFromMnemonic({
      password: PASSWORD,
      words: TEST_MNEMONIC.split(" "),
    });
    expect(core.wallet.snapshot.get().session).toMatchObject({ isUnlocked: true });

    await expect(core.wallet.session.resetAutoLockTimer()).resolves.toMatchObject({ status: "unlocked" });
    await expect(core.wallet.session.setAutoLockDuration({ durationMs: 5 * 60 * 1000 })).resolves.toMatchObject({
      autoLockDurationMs: 5 * 60 * 1000,
    });
    await expect(core.wallet.session.lock()).resolves.toMatchObject({ status: "locked" });
    await expect(core.wallet.session.unlock({ password: PASSWORD })).resolves.toMatchObject({ status: "unlocked" });
  });

  it("emits read invalidation when wallet state changes", async () => {
    const core = await createCoreRuntime(createCoreRuntimeInput());
    const listener = vi.fn();
    const unsubscribe = core.wallet.snapshot.subscribe(listener);

    await core.wallet.onboarding.createWalletFromMnemonic({
      password: PASSWORD,
      words: TEST_MNEMONIC.split(" "),
    });

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("returns wallet snapshots detached from mutable owner state", async () => {
    const core = await createCoreRuntime(createCoreRuntimeInput());

    const first = core.wallet.snapshot.get();
    const firstKnownNetwork = first.networks.known[0];
    if (!firstKnownNetwork) {
      throw new Error("expected default snapshot fixtures to include network state");
    }
    const originalNetworkName = firstKnownNetwork.displayName;

    first.accounts.totalCount = 999;
    firstKnownNetwork.displayName = "mutated network";

    const next = core.wallet.snapshot.get();
    expect(next).not.toBe(first);
    expect(next.accounts.totalCount).toBe(0);
    expect(next.networks.known[0]?.displayName).toBe(originalNetworkName);
  });

  it("does not emit read invalidation while subscribing to replaying owner state", async () => {
    const core = await createCoreRuntime(
      createCoreRuntimeInput({
        accountsPort: createSeededAccountsPort(),
        permissionsPort: createSeededPermissionsPort(),
      }),
    );

    const listener = vi.fn();
    const unsubscribe = core.wallet.snapshot.subscribe(listener);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("runs transaction restart recovery by default and can skip it explicitly", async () => {
    const runPort = new MemoryTransactionAggregatesPort();
    await runPort.insertTransactionAggregate(createRecoverableTransactionAggregate("submitting"));
    await createCoreRuntime(
      createCoreRuntimeInput({
        transactionAggregatesPort: runPort,
      }),
    );
    await expect(runPort.loadTransactionAggregate("tx-submitting")).resolves.toMatchObject({
      record: {
        status: "failed",
        terminalReason: {
          code: "incomplete_at_startup",
        },
      },
    });

    const skipPort = new MemoryTransactionAggregatesPort();
    await skipPort.insertTransactionAggregate(createRecoverableTransactionAggregate("submitted"));
    await createCoreRuntime(
      createCoreRuntimeInput({
        transactionAggregatesPort: skipPort,
        boot: { transactionRestartRecovery: "skip" },
      }),
    );
    await expect(skipPort.loadTransactionAggregate("tx-submitted")).resolves.toMatchObject({
      record: {
        status: "submitted",
        terminalReason: null,
      },
    });
  });

  it("fails boot when correctness-critical vault metadata cannot hydrate", async () => {
    await expectHydrationFailure(
      createCoreRuntimeInput({
        vaultMetaPort: new FailingVaultMetaPort(),
      }),
      { owner: "vault", resource: "vaultMeta" },
    );
  });

  it("fails boot when correctness-critical chain preferences cannot hydrate", async () => {
    await expectHydrationFailure(
      createCoreRuntimeInput({
        walletChainSelectionPort: new FailingWalletChainSelectionPort(),
      }),
      { owner: "chains", resource: "walletChainSelection" },
    );
  });

  it("fails boot when transaction restart recovery cannot read persisted aggregates", async () => {
    await expectHydrationFailure(
      createCoreRuntimeInput({
        transactionAggregatesPort: new FailingTransactionAggregatesPort(),
      }),
      { owner: "transactions", resource: "restartRecovery" },
    );
  });
});
