import { describe, expect, it, vi } from "vitest";
import { createAccountCodecRegistry, eip155Codec } from "../../accounts/addressing/codec.js";
import { Messenger } from "../../messenger/Messenger.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionRecord } from "../../storage/records.js";
import { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import { TRANSACTION_STATUS_CHANGED, TRANSACTION_TOPICS } from "./topics.js";
import type { TransactionStatusChange } from "./types.js";

const accountCodecs = createAccountCodecRegistry([eip155Codec]);
const chainRef = "eip155:1";
const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const createRecord = (overrides?: Partial<TransactionRecord>): TransactionRecord => ({
  id: "11111111-1111-4111-8111-111111111111",
  chainRef,
  origin: "https://dapp.example",
  fromAccountKey: accountCodecs.toAccountKeyFromAddress({ chainRef, address: from }),
  status: "broadcast",
  submitted: {
    hash: "0x1234",
    chainId: "0x1",
    from,
    nonce: "0x7",
  },
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const createService = (records: TransactionRecord[] = []): TransactionsService =>
  ({
    subscribeChanged: vi.fn(() => () => {}),
    get: vi.fn(async (id: string) => records.find((record) => record.id === id) ?? null),
    list: vi.fn(async () => records),
    findByReplacementIdentity: vi.fn(async (identity) =>
      records.filter((record) => JSON.stringify(record.replacementIdentity ?? null) === JSON.stringify(identity)),
    ),
    createSubmitted: vi.fn(),
    transition: vi.fn(),
    patchIfStatus: vi.fn(),
    remove: vi.fn(),
  }) as unknown as TransactionsService;

const createStore = (service: TransactionsService, messenger = new Messenger()) =>
  new TransactionRecordViewStore({
    messenger: messenger.scope({ publish: TRANSACTION_TOPICS }),
    service,
    accountCodecs,
    stateLimit: 10,
  });

describe("TransactionRecordViewStore", () => {
  it("does not emit status changes when loading a record into the cache", async () => {
    const record = createRecord({ status: "confirmed" });
    const messenger = new Messenger();
    const statusChanges: TransactionStatusChange[] = [];
    messenger.subscribe(TRANSACTION_STATUS_CHANGED, (change) => statusChanges.push(change));
    const store = createStore(createService([record]), messenger);

    await expect(store.getOrLoadView(record.id)).resolves.toMatchObject({
      id: record.id,
      status: "confirmed",
    });

    expect(statusChanges).toEqual([]);
  });

  it("keeps record views free of proposal-only fields", async () => {
    const record = createRecord();
    const store = createStore(createService([record]));

    const view = await store.getOrLoadView(record.id);
    expect(view).toMatchObject({
      kind: "record",
      id: record.id,
      namespace: "eip155",
      chainRef,
      status: "broadcast",
      submitted: record.submitted,
    });
    expect(view).not.toHaveProperty("request");
    expect(view).not.toHaveProperty("prepared");
    expect(view).not.toHaveProperty("error");
    expect(view).not.toHaveProperty("userRejected");
  });
});
