import { describe, expect, it, vi } from "vitest";
import { createAccountCodecRegistry, eip155Codec } from "../../accounts/addressing/codec.js";
import { Messenger } from "../../messenger/Messenger.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionRecord } from "../../storage/records.js";
import { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import { TRANSACTION_TOPICS } from "./topics.js";

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
  locator: { format: "eip155.tx_hash", value: "0x1234" },
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const createService = (records: TransactionRecord[] = []): TransactionsService =>
  ({
    subscribeChanged: vi.fn(() => () => {}),
    get: vi.fn(async (id: string) => records.find((record) => record.id === id) ?? null),
    list: vi.fn(async () => records),
    createSubmitted: vi.fn(),
    transition: vi.fn(),
    patchIfStatus: vi.fn(),
    remove: vi.fn(),
  }) as unknown as TransactionsService;

const createStore = (service: TransactionsService) =>
  new TransactionRecordViewStore({
    messenger: new Messenger().scope({ publish: TRANSACTION_TOPICS }),
    service,
    accountCodecs,
    stateLimit: 10,
  });

describe("TransactionRecordViewStore", () => {
  it("keeps record views free of proposal-only fields while preserving the TransactionMeta facade", async () => {
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
      locator: record.locator,
    });
    expect(view).not.toHaveProperty("request");
    expect(view).not.toHaveProperty("prepared");
    expect(view).not.toHaveProperty("error");
    expect(view).not.toHaveProperty("userRejected");

    expect(store.getMeta(record.id)).toMatchObject({
      id: record.id,
      request: null,
      prepared: null,
      error: null,
      userRejected: false,
      submitted: record.submitted,
      locator: record.locator,
    });
  });
});
