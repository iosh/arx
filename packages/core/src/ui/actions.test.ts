import { describe, expect, it } from "vitest";
import { uiActions } from "./actions.js";
import { uiMethods } from "./methods.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "./protocol.js";
import { parseUiMethodParams } from "./protocol.js";

describe("ui actions", () => {
  it("invokes all uiMethods keys exactly", () => {
    const called = new Set<string | number | symbol>();

    const client = {
      call: async <M extends UiMethodName>(_method: M, _params?: UiMethodParams<M>): Promise<UiMethodResult<M>> => {
        // Ensure sugar passes params that satisfy the protocol runtime contract.
        parseUiMethodParams(_method, _params);
        called.add(_method);
        return null as unknown as UiMethodResult<M>;
      },
    };

    const actions = uiActions(client as any);

    const methodKeys = Object.keys(uiMethods).sort();

    // Execute all sugar functions once to record which underlying methods are used.
    void actions.snapshot.get();

    void actions.attention.openNotification();

    void actions.session.unlock({ password: "pw" });
    void actions.session.lock();
    void actions.session.lock({ reason: "manual" });
    void actions.session.resetAutoLockTimer();
    void actions.session.setAutoLockDuration({ durationMs: 60_000 });

    void actions.onboarding.openTab({ reason: "reason" });
    void actions.onboarding.generateMnemonic();
    void actions.onboarding.createWalletFromMnemonic({
      words: Array.from<string>({ length: 12 }).fill("word"),
    });
    void actions.onboarding.importWalletFromMnemonic({
      words: Array.from<string>({ length: 12 }).fill("word"),
    });
    void actions.onboarding.importWalletFromPrivateKey({ privateKey: "deadbeef" });

    void actions.accounts.switchActive({ chainRef: "eip155:1" });
    void actions.accounts.switchActive({ chainRef: "eip155:1", address: null });
    void actions.accounts.switchActive({ chainRef: "eip155:1", address: "0x0" });

    void actions.networks.switchActive({ chainRef: "eip155:1" });

    void actions.approvals.approve({ id: "id" });
    void actions.approvals.reject({ id: "id" });
    void actions.approvals.reject({ id: "id", reason: "reason" });

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
    void actions.keyrings.renameAccount({ accountId: "eip155:0000000000000000000000000000000000000000", alias: "a" });
    void actions.keyrings.markBackedUp({ keyringId: "00000000-0000-0000-0000-000000000000" });
    void actions.keyrings.hideHdAccount({ accountId: "eip155:0000000000000000000000000000000000000000" });
    void actions.keyrings.unhideHdAccount({ accountId: "eip155:0000000000000000000000000000000000000000" });
    void actions.keyrings.removePrivateKeyKeyring({ keyringId: "00000000-0000-0000-0000-000000000000" });
    void actions.keyrings.exportMnemonic({ keyringId: "00000000-0000-0000-0000-000000000000", password: "pw" });
    void actions.keyrings.exportPrivateKey({ address: "0x0", password: "pw" });

    expect([...called].sort()).toEqual(methodKeys);
  });

  it("handles optional parameters correctly", async () => {
    const client = {
      call: async <M extends UiMethodName>(method: M, params?: UiMethodParams<M>) => {
        if (method === "ui.onboarding.generateMnemonic") {
          const wordCount = (params as any)?.wordCount ?? 12;
          return { words: Array.from<string>({ length: wordCount }).fill("word") };
        }
        return null as unknown as UiMethodResult<M>;
      },
    };

    const actions = uiActions(client as any);

    // Call without params
    const result1 = await actions.onboarding.generateMnemonic();
    expect(result1.words).toHaveLength(12);

    // Call with params
    const result2 = await actions.onboarding.generateMnemonic({ wordCount: 24 });
    expect(result2.words).toHaveLength(24);
  });

  it("passes parameters exactly as provided", async () => {
    const capturedParams: any[] = [];
    const client = {
      call: async <M extends UiMethodName>(_method: M, params?: UiMethodParams<M>) => {
        capturedParams.push(params);
        return null as unknown as UiMethodResult<M>;
      },
    };

    const actions = uiActions(client as any);

    await actions.session.unlock({ password: "test123" });
    expect(capturedParams[capturedParams.length - 1]).toEqual({ password: "test123" });

    await actions.accounts.switchActive({ chainRef: "eip155:1", address: null });
    expect(capturedParams[capturedParams.length - 1]).toEqual({
      chainRef: "eip155:1",
      address: null,
    });
  });

  it("maintains type safety for nested action groups", () => {
    const client = {
      call: async <M extends UiMethodName>(_method: M, _params?: UiMethodParams<M>) => {
        return null as unknown as UiMethodResult<M>;
      },
    };

    const actions = uiActions(client as any);

    // These should all be type-safe
    expect(typeof actions.snapshot.get).toBe("function");
    expect(typeof actions.session.unlock).toBe("function");
    expect(typeof actions.accounts.switchActive).toBe("function");
    expect(typeof actions.networks.switchActive).toBe("function");
    expect(typeof actions.approvals.approve).toBe("function");
  });
});
