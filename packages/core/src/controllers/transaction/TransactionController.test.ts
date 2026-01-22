import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainMetadata } from "../../chains/metadata.js";
import { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import type { TransactionAdapter } from "../../transactions/adapters/types.js";
import { cloneTransactionState } from "../../transactions/storage/state.js";
import type { AccountController } from "../account/types.js";
import type { ApprovalController, ApprovalTask } from "../approval/types.js";
import type { NetworkController } from "../network/types.js";
import { InMemoryTransactionController } from "./TransactionController.js";
import type {
  TransactionApprovalTaskPayload,
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
  chainRef: CHAIN.chainRef,
  payload: {
    from: ACCOUNT,
    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    value: "0x0",
    data: "0x",
  },
};

const USER_REJECTION_ERROR = { code: 4001, message: "User rejected" } as const;
type AdapterMocks = {
  buildDraft: ReturnType<typeof vi.fn<TransactionAdapter["buildDraft"]>>;
  signTransaction: ReturnType<typeof vi.fn<TransactionAdapter["signTransaction"]>>;
  broadcastTransaction: ReturnType<typeof vi.fn<TransactionAdapter["broadcastTransaction"]>>;
};
const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

type HarnessOptions = {
  initialState?: TransactionState;
  adapterOverrides?: Partial<AdapterMocks>;
  approvalRejects?: boolean;
  simulateApproval?: boolean; // If true, automatically approve in mock; default false
};

type TestHarness = {
  controller: InMemoryTransactionController;
  messenger: TransactionMessenger;
  adapter: TransactionAdapter & AdapterMocks;
  approvals: Pick<ApprovalController, "requestApproval">;
  capturedApprovalTasks: ApprovalTask<unknown>[];
  events: {
    queued: TransactionMeta[];
    status: Array<{ previous: string; next: string }>;
    states: TransactionState[];
  };
};

const createTestHarness = (options?: HarnessOptions): TestHarness => {
  const opts = options ?? {};
  let clock = 1_000;
  const now = () => {
    clock += 1;
    return clock;
  };

  const messenger = new ControllerMessenger<TransactionMessengerTopics>({});
  const registry = new TransactionAdapterRegistry();

  const adapter: TestHarness["adapter"] = {
    buildDraft: vi.fn<TransactionAdapter["buildDraft"]>(async (_context) => ({
      prepared: { raw: "0x" },
      summary: { kind: "transfer" },
      warnings: [],
      issues: [],
    })),
    signTransaction: vi.fn<TransactionAdapter["signTransaction"]>(async (_context, _draft) => ({
      raw: "0x1111",
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    })),
    broadcastTransaction: vi.fn<TransactionAdapter["broadcastTransaction"]>(async (_context, signed) => ({
      hash: signed.hash ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    })),
  };

  if (opts.adapterOverrides?.buildDraft) {
    adapter.buildDraft = opts.adapterOverrides.buildDraft;
  }
  if (opts.adapterOverrides?.signTransaction) {
    adapter.signTransaction = opts.adapterOverrides.signTransaction;
  }
  if (opts.adapterOverrides?.broadcastTransaction) {
    adapter.broadcastTransaction = opts.adapterOverrides.broadcastTransaction;
  }

  registry.register("eip155", adapter);

  let createdController: InMemoryTransactionController | null = null;

  const networkStub: Pick<NetworkController, "getActiveChain" | "getChain"> = {
    getActiveChain: () => CHAIN,
    getChain: (chainRef) => (chainRef === CHAIN.chainRef ? CHAIN : null),
  };
  const accountsStub: Pick<AccountController, "getActivePointer"> = {
    getActivePointer: () => ({ namespace: "eip155", chainRef: CHAIN.chainRef, address: ACCOUNT }),
  };
  const capturedApprovalTasks: ApprovalTask<unknown>[] = [];

  const requestApprovalMock: ApprovalController["requestApproval"] = async <TInput>(
    task: ApprovalTask<TInput>,
  ): Promise<unknown> => {
    capturedApprovalTasks.push(task as ApprovalTask<unknown>);

    // Simulate UI approval flow
    return new Promise((resolve, reject) => {
      // Defer execution to allow synchronous submitTransaction to complete first
      setTimeout(async () => {
        if (opts.approvalRejects) {
          if (createdController) {
            const rejection = Object.assign(new Error(USER_REJECTION_ERROR.message), USER_REJECTION_ERROR);
            await createdController.rejectTransaction(task.id, rejection);
          }
          reject(USER_REJECTION_ERROR);
          return;
        }

        // Simulate approval: if enabled, call approveTransaction
        if (opts.simulateApproval && createdController) {
          try {
            const approvedMeta = await createdController.approveTransaction(task.id);
            resolve(approvedMeta);
          } catch (error) {
            reject(error);
          }
          return;
        }

        // Default: throw rejection (no auto-approval)
        if (createdController) {
          const rejection = new Error("Transaction rejected by stub");
          await createdController.rejectTransaction(task.id, rejection);
        }
        reject(new Error("Transaction rejected by stub"));
      }, 0);
    });
  };

  const approvalsStub: Pick<ApprovalController, "requestApproval"> & {
    mock: typeof requestApprovalMock;
  } = {
    requestApproval: requestApprovalMock,
    mock: requestApprovalMock,
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
    ...(opts.initialState ? { initialState: opts.initialState } : {}),
  });
  createdController = controller;

  messenger.subscribe("transaction:queued", (meta) => {
    events.queued.push(meta);
  });
  messenger.subscribe("transaction:statusChanged", (change) => {
    events.status.push({ previous: change.previousStatus, next: change.nextStatus });
  });
  messenger.subscribe("transaction:stateChanged", (state) => {
    events.states.push(cloneTransactionState(state));
  });

  return {
    controller,
    messenger: messenger as TransactionMessenger,
    adapter,
    approvals: approvalsStub,
    capturedApprovalTasks,
    events,
  };
};
describe("InMemoryTransactionController", () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness({ simulateApproval: true });
  });

  it("emits queue and status events while processing an approved transaction", async () => {
    const result = await harness.controller.submitTransaction(ORIGIN, REQUEST);
    const approvalTask = harness.capturedApprovalTasks.at(-1) as
      | ApprovalTask<TransactionApprovalTaskPayload>
      | undefined;
    expect(approvalTask?.payload.chain?.chainRef).toBe(CHAIN.chainRef);
    expect(approvalTask?.payload.from).toBe(ACCOUNT);
    expect(approvalTask?.payload.prepared).toEqual({ raw: "0x" });
    expect(approvalTask?.payload.warnings).toEqual([]);
    expect(approvalTask?.payload.issues).toEqual([]);
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
      chainRef: CHAIN.chainRef,
      origin: ORIGIN,
      from: ACCOUNT,
      request: {
        namespace: "eip155",
        chainRef: CHAIN.chainRef,
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
      simulateApproval: true,
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
    harness = createTestHarness({ simulateApproval: false });

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
      chainRef: CHAIN.chainRef,
      origin: ORIGIN,
      from: ACCOUNT,
      request: {
        namespace: "eip155",
        chainRef: CHAIN.chainRef,
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
      simulateApproval: true,
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

  it("marks transaction as user rejected when approval rejects with 4001", async () => {
    harness = createTestHarness({ simulateApproval: false, approvalRejects: true });

    await expect(harness.controller.submitTransaction(ORIGIN, REQUEST)).rejects.toMatchObject(USER_REJECTION_ERROR);

    const finalState = harness.controller.getState();
    expect(finalState.pending).toHaveLength(0);
    expect(finalState.history).toHaveLength(1);

    const rejectedMeta = finalState.history[0];
    expect(rejectedMeta?.status).toBe("failed");
    expect(rejectedMeta?.userRejected).toBe(true);
    expect(rejectedMeta?.error).toMatchObject(USER_REJECTION_ERROR);

    expect(harness.events.queued).toHaveLength(1);
    expect(harness.events.status).toEqual([{ previous: "pending", next: "failed" }]);
  });

  it("records signing errors and stops processing", async () => {
    const signFailure = vi.fn(async () => {
      throw new Error("signing failed");
    });

    harness = createTestHarness({
      simulateApproval: true,
      adapterOverrides: { signTransaction: signFailure },
    });

    const result = await harness.controller.submitTransaction(ORIGIN, REQUEST);
    expect(result.status).toBe("approved");

    await flushMicrotasks();

    const finalState = harness.controller.getState();
    expect(finalState.pending).toHaveLength(0);
    expect(finalState.history).toHaveLength(1);

    const failedMeta = finalState.history[0];
    expect(failedMeta?.status).toBe("failed");
    expect(failedMeta?.error?.message).toBe("signing failed");
    expect(failedMeta?.hash).toBeNull();
    expect(failedMeta?.userRejected).toBe(false);

    expect(harness.adapter.buildDraft).toHaveBeenCalledTimes(1);
    expect(signFailure).toHaveBeenCalledTimes(1);
    expect(harness.events.status).toEqual([
      { previous: "pending", next: "approved" },
      { previous: "approved", next: "failed" },
    ]);
  });

  it("captures broadcast errors and preserves state", async () => {
    const broadcastError = Object.assign(new Error("insufficient funds"), { code: -32000 });
    const failingBroadcast = vi.fn(async () => {
      throw broadcastError;
    });
    harness = createTestHarness({
      simulateApproval: true,
      adapterOverrides: { broadcastTransaction: failingBroadcast },
    });

    const result = await harness.controller.submitTransaction(ORIGIN, REQUEST);
    expect(result.status).toBe("approved");

    await flushMicrotasks();

    const finalState = harness.controller.getState();
    expect(finalState.pending).toHaveLength(0);
    expect(finalState.history).toHaveLength(1);

    const failedMeta = finalState.history[0];
    expect(failedMeta?.status).toBe("failed");
    expect(failedMeta?.hash).toBe("0x1111111111111111111111111111111111111111111111111111111111111111");
    expect(failedMeta?.error).toMatchObject({ code: -32000, message: "insufficient funds" });
    expect(failedMeta?.userRejected).toBe(false);

    expect(harness.adapter.buildDraft).toHaveBeenCalledTimes(1);
    expect(harness.adapter.signTransaction).toHaveBeenCalledTimes(1);
    expect(failingBroadcast).toHaveBeenCalledTimes(1);

    expect(harness.events.status).toEqual([
      { previous: "pending", next: "approved" },
      { previous: "approved", next: "signed" },
      { previous: "signed", next: "failed" },
    ]);
  });
});
