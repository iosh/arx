import { ArxBaseError } from "@arx/core";
import type { WalletApi, WalletApiEvent } from "@arx/core/wallet";
import { createInMemoryChannelPair, type InMemoryChannelPair } from "@arx/message-channel/testing";
import { describe, expect, it, vi } from "vitest";
import { createWalletClient, WalletApiError, WalletChannelDisconnectedError } from "./client.js";
import { createWalletHost } from "./host.js";

const createTestWalletApi = (overrides: Record<string, unknown>): WalletApi =>
  ({
    subscribe: () => () => undefined,
    ...overrides,
  }) as unknown as WalletApi;

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
      details: { field: "accountId" },
      cause: new Error("private cause"),
    });
  }
}

describe("WalletClient and WalletHost", () => {
  it("round-trips nested methods and does not make the client thenable", async () => {
    const getAccount = vi.fn(async (accountId: string) => accountId);
    const { client, pair } = connect(createTestWalletApi({ accounts: { get: getAccount } }));

    expect((client as unknown as { then?: unknown }).then).toBeUndefined();
    await expect(client.accounts.get("eip155:0x1")).resolves.toBe("eip155:0x1");
    expect(getAccount).toHaveBeenCalledWith("eip155:0x1");

    pair.disconnect();
  });

  it("matches out-of-order responses and keeps request IDs isolated per channel", async () => {
    const firstResult = Promise.withResolvers<string>();
    const getAccount = vi.fn((accountId: string) =>
      accountId === "first" ? firstResult.promise : Promise.resolve(accountId),
    );
    const api = createTestWalletApi({ accounts: { get: getAccount } });
    const host = createWalletHost({ api });
    const firstPair = createInMemoryChannelPair();
    const secondPair = createInMemoryChannelPair();
    host.attach(firstPair.right);
    host.attach(secondPair.right);
    const first = createWalletClient({ channel: firstPair.left });
    const second = createWalletClient({ channel: secondPair.left });

    const pendingFirst = first.accounts.get("first");
    await expect(Promise.all([first.accounts.get("later"), second.accounts.get("second")])).resolves.toEqual([
      "later",
      "second",
    ]);
    firstResult.resolve("first");
    await expect(pendingFirst).resolves.toBe("first");

    firstPair.disconnect();
    secondPair.disconnect();
  });

  it("serializes domain errors and hides unexpected error details", async () => {
    const getAccount = vi.fn(async (accountId: string) => {
      if (accountId === "domain") {
        throw new TestDomainError();
      }

      throw new Error("private unexpected detail");
    });
    const { client, pair } = connect(createTestWalletApi({ accounts: { get: getAccount } }));
    const sent = vi.spyOn(pair.right, "send");

    const domainFailure = await client.accounts.get("domain").catch((error: unknown) => error);
    expect(domainFailure).toBeInstanceOf(WalletApiError);
    expect(domainFailure).toMatchObject({
      code: TestDomainError.code,
      message: "The domain operation failed.",
      details: { field: "accountId" },
    });

    const unexpectedFailure = await client.accounts.get("unexpected").catch((error: unknown) => error);
    expect(unexpectedFailure).toMatchObject({
      code: "wallet_api.internal_error",
      message: "Wallet operation failed.",
    });
    expect(sent.mock.calls).toEqual([
      [
        {
          type: "failure",
          id: 1,
          error: {
            code: TestDomainError.code,
            message: "The domain operation failed.",
            details: { field: "accountId" },
          },
        },
      ],
      [
        {
          type: "failure",
          id: 2,
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
    const api = createTestWalletApi({ subscribe, accounts: { get: vi.fn() } });
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
    const command = Promise.withResolvers<string>();
    const getAccount = vi.fn(() => command.promise);
    const { client, pair } = connect(createTestWalletApi({ accounts: { get: getAccount } }));
    const sent = vi.spyOn(pair.right, "send");

    const pending = client.accounts.get("slow");
    expect(getAccount).toHaveBeenCalledOnce();

    pair.disconnect();
    await expect(pending).rejects.toBeInstanceOf(WalletChannelDisconnectedError);
    await expect(client.accounts.get("later")).rejects.toBeInstanceOf(WalletChannelDisconnectedError);

    command.resolve("completed");
    await command.promise;
    expect(sent).not.toHaveBeenCalled();
  });

  it("does not disconnect other requests when one send fails", async () => {
    const firstResult = Promise.withResolvers<string>();
    const getAccount = vi.fn((accountId: string) =>
      accountId === "first" ? firstResult.promise : Promise.resolve(accountId),
    );
    const { client, pair } = connect(createTestWalletApi({ accounts: { get: getAccount } }));
    const first = client.accounts.get("first");
    const completedFirst = expect(first).resolves.toBe("first");
    const sendError = new Error("postMessage failed");
    vi.spyOn(pair.left, "send").mockImplementationOnce(() => {
      throw sendError;
    });

    await expect(client.accounts.get("failed")).rejects.toBe(sendError);
    await expect(client.accounts.get("later")).resolves.toBe("later");
    firstResult.resolve("first");
    await completedFirst;
    expect(getAccount.mock.calls).toEqual([["first"], ["later"]]);
    pair.disconnect();
  });
});
