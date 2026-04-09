import { describe, expect, it } from "vitest";
import { uiActions, uiCommonActions } from "./actions.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "./protocol/index.js";
import { parseUiMethodParams } from "./protocol/index.js";
import { uiMethods } from "./protocol/methods.js";

type UiClient = Parameters<typeof uiActions>[0];

const createTestClient = (call: UiClient["call"]): UiClient => {
  return {
    connect: async () => {},
    call,
    on: () => () => {},
    getLastSnapshot: () => null,
    waitForSnapshot: async () => {
      throw new Error("Not implemented in unit tests");
    },
    destroy: () => {},
    extend: function <E extends Record<string, unknown>>(
      this: UiClient & Record<string, unknown>,
      extension: (client: UiClient) => E,
    ) {
      return Object.assign(this, extension(this as UiClient)) as UiClient & E;
    },
  };
};

describe("ui actions", () => {
  it("invokes all uiMethods keys exactly", () => {
    const called = new Set<string | number | symbol>();

    const client = createTestClient(
      async <M extends UiMethodName>(_method: M, _params?: UiMethodParams<M>): Promise<UiMethodResult<M>> => {
        // Ensure sugar passes params that satisfy the protocol runtime contract.
        parseUiMethodParams(_method, _params);
        called.add(_method);
        return null as unknown as UiMethodResult<M>;
      },
    );

    const actions = uiActions(client);

    const methodKeys = Object.keys(uiMethods).sort();

    // Execute all sugar functions once to record which underlying methods are used.
    void actions.snapshot.get();
    void actions.entry.getLaunchContext({ environment: "popup" });

    void actions.balances.getNative({ chainRef: "eip155:1", address: "0x0" });

    void actions.session.unlock({ password: "pw" });
    void actions.session.lock();
    void actions.session.lock({ reason: "manual" });
    void actions.session.resetAutoLockTimer();
    void actions.session.setAutoLockDuration({ durationMs: 60_000 });

    void actions.onboarding.openTab({ reason: "reason" });
    void actions.onboarding.generateMnemonic();
    void actions.onboarding.createWalletFromMnemonic({
      password: "pw",
      words: Array.from<string>({ length: 12 }).fill("word"),
    });
    void actions.onboarding.importWalletFromMnemonic({
      password: "pw",
      words: Array.from<string>({ length: 12 }).fill("word"),
    });
    void actions.onboarding.importWalletFromPrivateKey({ password: "pw", privateKey: "deadbeef" });

    void actions.accounts.switchActive({ chainRef: "eip155:1" });
    void actions.accounts.switchActive({ chainRef: "eip155:1", accountKey: null });
    void actions.accounts.switchActive({
      chainRef: "eip155:1",
      accountKey: "eip155:0000000000000000000000000000000000000000",
    });

    void actions.networks.switchActive({ chainRef: "eip155:1" });

    void actions.transactions.requestSendTransactionApproval({
      to: "0x0000000000000000000000000000000000000000",
      valueEther: "0.01",
      chainRef: "eip155:1",
    });

    void actions.approvals.openPopup();
    void actions.approvals.resolve({ id: "id", action: "approve" });
    void actions.approvals.resolve({ id: "id", action: "reject" });
    void actions.approvals.resolve({ id: "id", action: "reject", reason: "reason" });

    void actions.keyrings.confirmNewMnemonic({
      words: Array.from<string>({ length: 12 }).fill("word"),
    });
    void actions.keyrings.importMnemonic({
      words: Array.from<string>({ length: 12 }).fill("word"),
    });
    void actions.keyrings.importPrivateKey({ privateKey: "deadbeef" });
    void actions.keyrings.deriveAccount({ keyringId: "00000000-0000-0000-0000-000000000000" });
    void actions.keyrings.list();
    void actions.keyrings.getAccountsByKeyring({ keyringId: "00000000-0000-0000-0000-000000000000" });
    void actions.keyrings.renameKeyring({ keyringId: "00000000-0000-0000-0000-000000000000", alias: "a" });
    void actions.keyrings.renameAccount({ accountKey: "eip155:0000000000000000000000000000000000000000", alias: "a" });
    void actions.keyrings.markBackedUp({ keyringId: "00000000-0000-0000-0000-000000000000" });
    void actions.keyrings.hideHdAccount({ accountKey: "eip155:0000000000000000000000000000000000000000" });
    void actions.keyrings.unhideHdAccount({ accountKey: "eip155:0000000000000000000000000000000000000000" });
    void actions.keyrings.removePrivateKeyKeyring({ keyringId: "00000000-0000-0000-0000-000000000000" });
    void actions.keyrings.exportMnemonic({ keyringId: "00000000-0000-0000-0000-000000000000", password: "pw" });
    void actions.keyrings.exportPrivateKey({
      accountKey: "eip155:0000000000000000000000000000000000000000",
      password: "pw",
    });

    expect([...called].sort()).toEqual(methodKeys);
  });

  it("handles optional parameters correctly", async () => {
    const client = createTestClient(async <M extends UiMethodName>(method: M, params?: UiMethodParams<M>) => {
      if (method === "ui.onboarding.generateMnemonic") {
        const generateParams = params as UiMethodParams<"ui.onboarding.generateMnemonic"> | undefined;
        const wordCount = generateParams?.wordCount ?? 12;
        return { words: Array.from<string>({ length: wordCount }).fill("word") };
      }
      return null as unknown as UiMethodResult<M>;
    });

    const actions = uiActions(client);

    // Call without params
    const result1 = await actions.onboarding.generateMnemonic();
    expect(result1.words).toHaveLength(12);

    // Call with params
    const result2 = await actions.onboarding.generateMnemonic({ wordCount: 24 });
    expect(result2.words).toHaveLength(24);
  });

  it("passes parameters exactly as provided", async () => {
    const capturedParams: unknown[] = [];
    const client = createTestClient(async <M extends UiMethodName>(_method: M, params?: UiMethodParams<M>) => {
      capturedParams.push(params);
      return null as unknown as UiMethodResult<M>;
    });

    const actions = uiActions(client);

    await actions.session.unlock({ password: "test123" });
    expect(capturedParams[capturedParams.length - 1]).toEqual({ password: "test123" });

    await actions.accounts.switchActive({ chainRef: "eip155:1", accountKey: null });
    expect(capturedParams[capturedParams.length - 1]).toEqual({
      chainRef: "eip155:1",
      accountKey: null,
    });
  });

  it("maintains type safety for nested action groups", () => {
    const client = createTestClient(async <M extends UiMethodName>(_method: M, _params?: UiMethodParams<M>) => {
      return null as unknown as UiMethodResult<M>;
    });

    const actions = uiActions(client);

    // These should all be type-safe
    expect(typeof actions.snapshot.get).toBe("function");
    expect(typeof actions.entry.getLaunchContext).toBe("function");
    expect(typeof actions.session.unlock).toBe("function");
    expect(typeof actions.accounts.switchActive).toBe("function");
    expect(typeof actions.networks.switchActive).toBe("function");
    expect(typeof actions.approvals.resolve).toBe("function");
  });

  it("does not include activation helpers in uiCommonActions", () => {
    const client = createTestClient(async <M extends UiMethodName>(_method: M, _params?: UiMethodParams<M>) => {
      return null as unknown as UiMethodResult<M>;
    });

    const actions = uiCommonActions(client);

    expect("openTab" in actions.onboarding).toBe(false);
    expect("openPopup" in actions.approvals).toBe(false);
  });
});
