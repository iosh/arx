import { ArxBaseError } from "@arx/core";
import type { WalletApi, WalletApiEvent } from "@arx/core/wallet";
import type { DuplexChannel } from "@arx/message-channel";
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

  it("keeps concurrent request IDs isolated per channel", async () => {
    const getAccount = vi.fn(async (accountId: string) => accountId);
    const api = createTestWalletApi({ accounts: { get: getAccount } });
    const host = createWalletHost({ api });
    const firstPair = createInMemoryChannelPair();
    const secondPair = createInMemoryChannelPair();
    host.attach(firstPair.right);
    host.attach(secondPair.right);
    const first = { client: createWalletClient({ channel: firstPair.left }), pair: firstPair };
    const second = { client: createWalletClient({ channel: secondPair.left }), pair: secondPair };

    await expect(
      Promise.all([first.client.accounts.get("first"), second.client.accounts.get("second")]),
    ).resolves.toEqual(["first", "second"]);
    expect(getAccount).toHaveBeenCalledTimes(2);

    first.pair.disconnect();
    second.pair.disconnect();
  });

  it("serializes domain errors and hides unexpected error details", async () => {
    const getAccount = vi.fn(async (accountId: string) => {
      if (accountId === "domain") {
        throw new TestDomainError();
      }

      throw new Error("private unexpected detail");
    });
    const { client, pair } = connect(createTestWalletApi({ accounts: { get: getAccount } }));

    const domainFailure = await client.accounts.get("domain").catch((error: unknown) => error);
    expect(domainFailure).toBeInstanceOf(WalletApiError);
    expect(domainFailure).toMatchObject({
      code: TestDomainError.code,
      message: "The domain operation failed.",
      details: { field: "accountId" },
    });
    expect(domainFailure).not.toHaveProperty("cause");

    const unexpectedFailure = await client.accounts.get("unexpected").catch((error: unknown) => error);
    expect(unexpectedFailure).toMatchObject({
      code: "wallet_api.internal_error",
      message: "Wallet operation failed.",
    });
    expect((unexpectedFailure as Error).message).not.toContain("private unexpected detail");

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
    const first = { client: createWalletClient({ channel: firstPair.left }), pair: firstPair };
    const second = { client: createWalletClient({ channel: secondPair.left }), pair: secondPair };
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    first.client.subscribe(firstListener);
    second.client.subscribe(secondListener);
    expect(subscribe).toHaveBeenCalledOnce();

    const event = { type: "walletStatusChanged", status: "locked" } as const;
    publishEvent?.(event);
    expect(firstListener).toHaveBeenCalledWith(event);
    expect(secondListener).toHaveBeenCalledWith(event);

    const unknownMethod = (first.client as unknown as { missing(): Promise<unknown> }).missing();
    await expect(unknownMethod).rejects.toMatchObject({ code: "wallet_api.method_not_found" });

    first.pair.disconnect();
    second.pair.disconnect();
  });

  it("rejects pending and future calls on disconnect while the host command continues", async () => {
    let finishCommand: (() => void) | undefined;
    let commandFinished = false;
    const getAccount = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishCommand = () => {
            commandFinished = true;
            resolve("completed");
          };
        }),
    );
    const { client, pair } = connect(createTestWalletApi({ accounts: { get: getAccount } }));

    const pending = client.accounts.get("slow");
    expect(getAccount).toHaveBeenCalledOnce();

    pair.disconnect();
    await expect(pending).rejects.toBeInstanceOf(WalletChannelDisconnectedError);
    await expect(client.accounts.get("later")).rejects.toBeInstanceOf(WalletChannelDisconnectedError);

    finishCommand?.();
    await Promise.resolve();
    expect(commandFinished).toBe(true);
  });

  it("treats a synchronous send failure as a permanent disconnect", async () => {
    const channel: DuplexChannel = {
      send: () => {
        throw new Error("send failed");
      },
      onMessage: () => () => undefined,
      onDisconnect: () => () => undefined,
    };
    const client = createWalletClient({ channel });

    await expect(client.accounts.get("first")).rejects.toBeInstanceOf(WalletChannelDisconnectedError);
    await expect(client.accounts.get("second")).rejects.toBeInstanceOf(WalletChannelDisconnectedError);
  });
});
