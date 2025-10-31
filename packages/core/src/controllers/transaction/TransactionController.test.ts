import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainMetadata } from "../../chains/metadata.js";
import { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import type { TransactionAdapter, TransactionDraft } from "../../transactions/adapters/types.js";
import { cloneTransactionState } from "../../transactions/storage/state.js";
import type { AccountController } from "../account/types.js";
import type { ApprovalController } from "../approval/types.js";
import type { NetworkController } from "../network/types.js";
import { InMemoryTransactionController } from "./TransactionController.js";
import type {
  TransactionMessenger,
  TransactionMessengerTopics,
  TransactionMeta,
  TransactionRequest,
  TransactionState,
} from "./types.js";

const ORIGIN = "https://dapp.example";
const ACCOUNT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CHAIN: ChainMetadata = {
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum",
  shortName: "eth",
  description: "Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.example", type: "public" }],
};
const REQUEST: TransactionRequest<"eip155"> = {
  namespace: "eip155",
  caip2: CHAIN.chainRef,
  payload: {
    from: ACCOUNT,
    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    value: "0x0",
    data: "0x",
  },
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

type HarnessOptions = {
  autoApprove?: boolean;
  initialState?: TransactionState;
};

type TestHarness = {
  controller: InMemoryTransactionController;
  messenger: TransactionMessenger;
  adapter: TransactionAdapter & {
    buildDraft: ReturnType<typeof vi.fn<TransactionAdapter["buildDraft"]>>;
    signTransaction: ReturnType<typeof vi.fn<TransactionAdapter["signTransaction"]>>;
    broadcastTransaction: ReturnType<typeof vi.fn<TransactionAdapter["broadcastTransaction"]>>;
  };
  events: {
    queued: TransactionMeta[];
    status: Array<{ previous: string; next: string }>;
    states: TransactionState[];
  };
};

const createTestHarness = (options?: HarnessOptions): TestHarness => {
  let clock = 1_000;
  const now = () => {
    clock += 1;
    return clock;
  };

  const messenger = new ControllerMessenger<TransactionMessengerTopics>({});
  const registry = new TransactionAdapterRegistry();

  const adapter: TestHarness["adapter"] = {
    buildDraft: vi.fn(async (_context) => {
      const draft: TransactionDraft = {
        prepared: { raw: "0x" },
        summary: { kind: "transfer" },
        warnings: [],
        issues: [],
      };
      return draft;
    }),
    signTransaction: vi.fn(async (_context, _draft) => ({
      raw: "0x1111",
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    })),
    broadcastTransaction: vi.fn(async (_context, signed) => ({
      hash: signed.hash ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    })),
  };

  registry.register("eip155", adapter);

  const networkStub: Pick<NetworkController, "getActiveChain"> = {
    getActiveChain: () => CHAIN,
  };
  const accountsStub: Pick<AccountController, "getActivePointer"> = {
    getActivePointer: () => ({ namespace: "eip155", chainRef: CHAIN.chainRef, address: ACCOUNT }),
  };
  const approvalsStub: Pick<ApprovalController, "requestApproval"> = {
    requestApproval: vi.fn(async (task, strategy) => {
      if (!strategy) {
        throw new Error("strategy is required for approvals");
      }
      return strategy(task);
    }),
  };

  const events = {
    queued: [] as TransactionMeta[],
    status: [] as Array<{ previous: string; next: string }>,
    states: [] as TransactionState[],
  };

  const controller = new InMemoryTransactionController({
    messenger: messenger as TransactionMessenger,
    network: networkStub,
    accounts: accountsStub,
    approvals: approvalsStub,
    registry,
    idGenerator: () => "tx-1",
    now,
    autoApprove: options?.autoApprove ?? true,
    ...(options?.initialState ? { initialState: options.initialState } : {}),
  });

  messenger.subscribe("transaction:queued", (meta) => {
    events.queued.push(meta);
  });
  messenger.subscribe("transaction:statusChanged", (change) => {
    events.status.push({ previous: change.previousStatus, next: change.nextStatus });
  });
  messenger.subscribe("transaction:stateChanged", (state) => {
    events.states.push(cloneTransactionState(state));
  });

  return { controller, messenger: messenger as TransactionMessenger, adapter, events };
};

describe("InMemoryTransactionController", () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
  });

  it("emits queue and status events while processing an approved transaction", async () => {
    const result = await harness.controller.submitTransaction(ORIGIN, REQUEST);
    expect(result.status).toBe("approved");

    await flushMicrotasks();

    const finalState = harness.controller.getState();
    expect(finalState.pending).toHaveLength(0);
    expect(finalState.history).toHaveLength(1);
    expect(finalState.history[0]?.status).toBe("broadcast");
    expect(finalState.history[0]?.hash).toBe("0x1111111111111111111111111111111111111111111111111111111111111111");

    expect(harness.adapter.buildDraft).toHaveBeenCalledTimes(1);
    expect(harness.adapter.signTransaction).toHaveBeenCalledTimes(1);
    expect(harness.adapter.broadcastTransaction).toHaveBeenCalledTimes(1);

    expect(harness.events.queued).toHaveLength(1);
    expect(harness.events.queued[0]?.status).toBe("pending");

    expect(harness.events.status).toEqual([
      { previous: "pending", next: "approved" },
      { previous: "approved", next: "signed" },
      { previous: "signed", next: "broadcast" },
    ]);

    const broadcastObserved = harness.events.states.some((snapshot) =>
      snapshot.history.some((meta) => meta.status === "broadcast"),
    );
    expect(broadcastObserved).toBe(true);
  });

  it("reprocesses approved entries on resumePending without requeuing", async () => {
    const approvedMeta: TransactionMeta = {
      id: "tx-1",
      namespace: "eip155",
      caip2: CHAIN.chainRef,
      origin: ORIGIN,
      from: ACCOUNT,
      request: {
        namespace: "eip155",
        caip2: CHAIN.chainRef,
        payload: { ...REQUEST.payload },
      },
      status: "approved",
      hash: null,
      receipt: null,
      error: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 900,
      updatedAt: 900,
    };

    harness = createTestHarness({
      autoApprove: false,
      initialState: { pending: [], history: [approvedMeta] },
    });

    await harness.controller.resumePending();
    await flushMicrotasks();

    expect(harness.adapter.buildDraft).toHaveBeenCalledTimes(1);
    expect(harness.adapter.signTransaction).toHaveBeenCalledTimes(1);
    expect(harness.adapter.broadcastTransaction).toHaveBeenCalledTimes(1);

    const resumedMeta = harness.controller.getMeta("tx-1");
    expect(resumedMeta?.status).toBe("broadcast");
    expect(resumedMeta?.hash).toBe("0x1111111111111111111111111111111111111111111111111111111111111111");

    expect(harness.events.queued).toHaveLength(0);
    expect(harness.events.status).toEqual([
      { previous: "approved", next: "signed" },
      { previous: "signed", next: "broadcast" },
    ]);

    const resumedBroadcastObserved = harness.events.states.some((snapshot) =>
      snapshot.history.some((meta) => meta.id === "tx-1" && meta.status === "broadcast"),
    );
    expect(resumedBroadcastObserved).toBe(true);
  });

  it("persists failure state when auto approval is disabled", async () => {
    harness = createTestHarness({ autoApprove: false });

    await expect(harness.controller.submitTransaction(ORIGIN, REQUEST)).rejects.toThrow("Transaction rejected by stub");

    const finalState = harness.controller.getState();
    expect(finalState.pending).toHaveLength(0);
    expect(finalState.history).toHaveLength(1);

    const failedMeta = finalState.history[0];
    expect(failedMeta?.status).toBe("failed");
    expect(failedMeta?.error?.message).toBe("Transaction rejected by stub");
    expect(failedMeta?.userRejected).toBe(false);

    expect(harness.events.queued).toHaveLength(1);
    expect(harness.events.status).toEqual([{ previous: "pending", next: "failed" }]);

    const failureObserved = harness.events.states.some((snapshot) =>
      snapshot.history.some((meta) => meta.status === "failed"),
    );
    expect(failureObserved).toBe(true);
  });

  it("resumes already signed transactions and finalizes broadcast", async () => {
    const signedMeta: TransactionMeta = {
      id: "tx-1",
      namespace: "eip155",
      caip2: CHAIN.chainRef,
      origin: ORIGIN,
      from: ACCOUNT,
      request: {
        namespace: "eip155",
        caip2: CHAIN.chainRef,
        payload: { ...REQUEST.payload },
      },
      status: "signed",
      hash: null,
      receipt: null,
      error: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 900,
      updatedAt: 900,
    };

    harness = createTestHarness({
      autoApprove: false,
      initialState: { pending: [], history: [signedMeta] },
    });

    await harness.controller.resumePending();
    await flushMicrotasks();

    expect(harness.adapter.buildDraft).toHaveBeenCalledTimes(1);
    expect(harness.adapter.signTransaction).toHaveBeenCalledTimes(1);
    expect(harness.adapter.broadcastTransaction).toHaveBeenCalledTimes(1);

    const resumedMeta = harness.controller.getMeta("tx-1");
    expect(resumedMeta?.status).toBe("broadcast");
    expect(resumedMeta?.hash).toBe("0x1111111111111111111111111111111111111111111111111111111111111111");

    expect(harness.events.queued).toHaveLength(0);
    expect(harness.events.status).toEqual([{ previous: "signed", next: "broadcast" }]);

    const broadcastObserved = harness.events.states.some((snapshot) =>
      snapshot.history.some((meta) => meta.id === "tx-1" && meta.status === "broadcast"),
    );
    expect(broadcastObserved).toBe(true);
  });
});
