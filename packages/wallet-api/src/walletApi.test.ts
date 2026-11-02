import { ArxBaseError } from "@arx/core";
import type { AccountGroup } from "@arx/core/accounts";
import type { WalletApi, WalletApiEvent } from "@arx/core/wallet";
import { createInMemoryChannelPair, type InMemoryChannelPair } from "@arx/message-channel/testing";
import { assert, describe, expect, it, vi } from "vitest";
import { createWalletClient, WalletApiError, WalletChannelDisconnectedError } from "./client.js";
import { createWalletHost } from "./host.js";

type GetGroup = WalletApi["accounts"]["getGroup"];
type ApiStub = Readonly<{
  accounts: Pick<WalletApi["accounts"], "getGroup">;
  subscribe?: WalletApi["subscribe"];
}>;

const createTestWalletApi = (overrides: ApiStub): WalletApi =>
  ({
    subscribe: () => () => undefined,
    ...overrides,
  }) as WalletApi;

const group = (accountGroupId: string, addressSuffix: number): AccountGroup => {
  const keySourceId = `source-${accountGroupId}`;
  return {
    accountGroupId,
    source: { type: "private-key", keySourceId },
    hidden: false,
    createdAt: 1,
    selected: false,
    members: [
      {
        accountId: `eip155:${addressSuffix.toString(16).padStart(40, "0")}`,
        accountGroupId,
        namespace: "eip155",
        origin: { type: "private-key", keySourceId },
        hidden: false,
      },
    ],
  };
};

const firstGroup = group("group-first", 1);
const laterGroup = group("group-later", 2);
const secondGroup = group("group-second", 3);

const connect = (api: WalletApi): { client: WalletApi; pair: InMemoryChannelPair } => {
  const pair = createInMemoryChannelPair();
  const host = createWalletHost({ api });
  host.attach(pair.right);
  return { client: createWalletClient({ channel: pair.left }), pair };
};

class TestDomainError extends ArxBaseError {
  static readonly code = "test.domain_failure";

  constructor() {
    super("The domain operation failed.", {
      code: TestDomainError.code,
      details: { field: "accountGroupId" },
      cause: new Error("private cause"),
    });
  }
}

describe("WalletClient and WalletHost", () => {
  it("routes nested methods and matches out-of-order responses independently per channel", async () => {
    const firstResult = Promise.withResolvers<AccountGroup>();
    const results = new Map([laterGroup, secondGroup].map((result) => [result.accountGroupId, result]));
    const getGroup = vi.fn<GetGroup>(async (accountGroupId) => {
      if (accountGroupId === firstGroup.accountGroupId) return firstResult.promise;
      const result = results.get(accountGroupId);
      assert(result !== undefined);
      return result;
    });
    const api = createTestWalletApi({ accounts: { getGroup } });
    const host = createWalletHost({ api });
    const firstPair = createInMemoryChannelPair();
    const secondPair = createInMemoryChannelPair();
    host.attach(firstPair.right);
    host.attach(secondPair.right);
    const first = createWalletClient({ channel: firstPair.left });
    const second = createWalletClient({ channel: secondPair.left });

    expect((first as unknown as { then?: unknown }).then).toBeUndefined();
    const pendingFirst = first.accounts.getGroup(firstGroup.accountGroupId);
    await expect(
      Promise.all([
        first.accounts.getGroup(laterGroup.accountGroupId),
        second.accounts.getGroup(secondGroup.accountGroupId),
      ]),
    ).resolves.toEqual([laterGroup, secondGroup]);
    firstResult.resolve(firstGroup);
    await expect(pendingFirst).resolves.toEqual(firstGroup);

    firstPair.disconnect();
    secondPair.disconnect();
  });

  it("serializes domain errors and hides unexpected error details", async () => {
    const getGroup = vi.fn<GetGroup>(async (accountGroupId) => {
      if (accountGroupId === "domain") {
        throw new TestDomainError();
      }

      throw new Error("private unexpected detail");
    });
    const { client, pair } = connect(createTestWalletApi({ accounts: { getGroup } }));
    const sent = vi.spyOn(pair.right, "send");

    const domainFailure = await client.accounts.getGroup("domain").catch((error: unknown) => error);
    expect(domainFailure).toBeInstanceOf(WalletApiError);
    expect(domainFailure).toMatchObject({
      code: TestDomainError.code,
      message: "The domain operation failed.",
      details: { field: "accountGroupId" },
    });

    const unexpectedFailure = await client.accounts.getGroup("unexpected").catch((error: unknown) => error);
    expect(unexpectedFailure).toMatchObject({
      code: "wallet_api.internal_error",
      message: "Wallet operation failed.",
    });
    expect(sent.mock.calls).toEqual([
      [
        {
          type: "failure",
          id: expect.any(Number),
          error: {
            code: TestDomainError.code,
            message: "The domain operation failed.",
            details: { field: "accountGroupId" },
          },
        },
      ],
      [
        {
          type: "failure",
          id: expect.any(Number),
          error: {
            code: "wallet_api.internal_error",
            message: "Wallet operation failed.",
          },
        },
      ],
    ]);

    pair.disconnect();
  });

  it("keeps subscribe local, rejects unknown methods, and fans out events", async () => {
    let publishEvent: ((event: WalletApiEvent) => void) | undefined;
    const subscribe = vi.fn((listener: (event: WalletApiEvent) => void) => {
      publishEvent = listener;
      return () => undefined;
    });
    const api = createTestWalletApi({ subscribe, accounts: { getGroup: vi.fn<GetGroup>() } });
    const host = createWalletHost({ api });
    const firstPair = createInMemoryChannelPair();
    const secondPair = createInMemoryChannelPair();
    host.attach(firstPair.right);
    host.attach(secondPair.right);
    const first = createWalletClient({ channel: firstPair.left });
    const second = createWalletClient({ channel: secondPair.left });
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    first.subscribe(firstListener);
    second.subscribe(secondListener);
    expect(subscribe).toHaveBeenCalledOnce();

    const event = { type: "walletStatusChanged", status: "locked" } as const;
    publishEvent?.(event);
    expect(firstListener).toHaveBeenCalledWith(event);
    expect(secondListener).toHaveBeenCalledWith(event);

    const unknownMethod = (first as unknown as { missing(): Promise<unknown> }).missing();
    await expect(unknownMethod).rejects.toMatchObject({ code: "wallet_api.method_not_found" });

    firstPair.disconnect();
    firstListener.mockClear();
    secondListener.mockClear();
    publishEvent?.(event);
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).toHaveBeenCalledWith(event);
    secondPair.disconnect();
  });

  it("rejects pending and future calls on disconnect and drops late results", async () => {
    const command = Promise.withResolvers<AccountGroup>();
    const getGroup = vi.fn<GetGroup>(() => command.promise);
    const { client, pair } = connect(createTestWalletApi({ accounts: { getGroup } }));
    const sent = vi.spyOn(pair.right, "send");

    const pending = client.accounts.getGroup(firstGroup.accountGroupId);

    pair.disconnect();
    await expect(pending).rejects.toBeInstanceOf(WalletChannelDisconnectedError);
    await expect(client.accounts.getGroup(laterGroup.accountGroupId)).rejects.toBeInstanceOf(
      WalletChannelDisconnectedError,
    );

    command.resolve(firstGroup);
    await command.promise;
    expect(sent).not.toHaveBeenCalled();
  });

  it("rejects a failed send before the port disconnect notification rejects other pending requests", async () => {
    const firstResult = Promise.withResolvers<AccountGroup>();
    const getGroup = vi.fn<GetGroup>(() => firstResult.promise);
    const { client, pair } = connect(createTestWalletApi({ accounts: { getGroup } }));
    const first = client.accounts.getGroup(firstGroup.accountGroupId);
    const cancelledFirst = expect(first).rejects.toBeInstanceOf(WalletChannelDisconnectedError);
    const sendError = new Error("Attempting to use a disconnected port");
    vi.spyOn(pair.left, "send").mockImplementationOnce(() => {
      throw sendError;
    });

    await expect(client.accounts.getGroup(laterGroup.accountGroupId)).rejects.toBe(sendError);
    pair.disconnect();
    await cancelledFirst;
    await expect(client.accounts.getGroup(secondGroup.accountGroupId)).rejects.toBeInstanceOf(
      WalletChannelDisconnectedError,
    );
    firstResult.resolve(firstGroup);
    await firstResult.promise;
    expect(getGroup).toHaveBeenCalledOnce();
  });
});
