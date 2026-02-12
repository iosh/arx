import { ArxReasons } from "@arx/errors";
import { describe, expect, it, vi } from "vitest";
import { PermissionScopes } from "../../../controllers/permission/types.js";
import { createLockedGuardMiddleware } from "./lockedGuard.js";

const ORIGIN = "https://dapp.example";

const createAttentionHelpers = () => {
  const requestAttention = vi.fn(() => ({ enqueued: true, request: null, state: { queue: [], count: 0 } }));
  return { requestAttention };
};
const defaultPassthroughAllowance = () => ({ isPassthrough: false, allowWhenLocked: false });

const createNextStub = () =>
  vi.fn<(returnHandler?: (runReturnHandlers: (error?: unknown) => void) => void) => Promise<void>>((returnHandler) => {
    if (returnHandler) {
      returnHandler((error) => {
        if (error) {
          throw error;
        }
      });
    }
    return Promise.resolve();
  });

describe("createLockedGuardMiddleware", () => {
  it("allows internal origins", async () => {
    const next = createNextStub();
    const attention = createAttentionHelpers();
    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: (origin) => origin === ORIGIN,
      findMethodDefinition: () => undefined,
      getPassthroughAllowance: defaultPassthroughAllowance,
      attentionService: attention,
    });

    const req = { method: "eth_chainId", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows unlocked sessions", async () => {
    const next = createNextStub();
    const attention = createAttentionHelpers();
    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => true,
      isInternalOrigin: () => false,
      findMethodDefinition: () => undefined,
      getPassthroughAllowance: defaultPassthroughAllowance,
      attentionService: attention,
    });

    const req = { method: "eth_chainId", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects when method definition is missing", async () => {
    const next = createNextStub();
    const end = vi.fn();
    const findMethodDefinition = vi.fn(() => undefined);
    const attention = createAttentionHelpers();
    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      findMethodDefinition,
      getPassthroughAllowance: defaultPassthroughAllowance,
      attentionService: attention,
    });

    const req = { method: "eth_unknown", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];

    await middleware(req, res, next, end);

    expect(next).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
    const [error] = end.mock.calls[0] ?? [];
    expect((error as any)?.reason).toBe(ArxReasons.RpcMethodNotFound);
    expect(findMethodDefinition).toHaveBeenCalledWith("eth_unknown", undefined);
    expect(attention.requestAttention).not.toHaveBeenCalled();
  });
  it("allows methods without scope", async () => {
    const next = createNextStub();
    const attention = createAttentionHelpers();
    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      findMethodDefinition: () => ({}),
      getPassthroughAllowance: defaultPassthroughAllowance,
      attentionService: attention,
    });

    const req = { method: "eth_chainId", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows methods when locked.allow is true", async () => {
    const next = createNextStub();
    const attention = createAttentionHelpers();
    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      findMethodDefinition: () => ({ scope: PermissionScopes.Accounts, locked: { allow: true } }),
      getPassthroughAllowance: defaultPassthroughAllowance,
      attentionService: attention,
    });

    const req = { method: "eth_chainId", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns locked.response payload", async () => {
    const next = createNextStub();
    const attention = createAttentionHelpers();
    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      findMethodDefinition: () => ({ scope: PermissionScopes.Accounts, locked: { response: ["0x123"] } }),
      getPassthroughAllowance: defaultPassthroughAllowance,
      attentionService: attention,
    });

    const req = { method: "eth_accounts", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).not.toHaveBeenCalled();
    expect(res.result).toEqual(["0x123"]);
  });

  it("allows passthrough methods when allowWhenLocked is true", async () => {
    const next = createNextStub();
    const attention = createAttentionHelpers();
    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      findMethodDefinition: () => undefined,
      getPassthroughAllowance: () => ({ isPassthrough: true, allowWhenLocked: true }),
      attentionService: attention,
    });

    const req = { method: "eth_blockNumber", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects passthrough methods that require unlocked sessions", async () => {
    const next = createNextStub();
    const attention = createAttentionHelpers();
    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      findMethodDefinition: () => undefined,
      getPassthroughAllowance: () => ({ isPassthrough: true, allowWhenLocked: false }),
      attentionService: attention,
    });

    const req = { method: "eth_newFilter", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).not.toHaveBeenCalled();
    const [error] = end.mock.calls[0] ?? [];
    expect((error as any)?.reason).toBe(ArxReasons.SessionLocked);

    expect(attention.requestAttention).toHaveBeenCalledWith({
      reason: "unlock_required",
      origin: ORIGIN,
      method: "eth_newFilter",
      chainRef: null,
      namespace: null,
    });
  });

  it("rejects scoped methods by default", async () => {
    const next = createNextStub();
    const end = vi.fn();
    const attention = createAttentionHelpers();
    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      findMethodDefinition: () => ({ scope: PermissionScopes.Accounts }),
      getPassthroughAllowance: defaultPassthroughAllowance,
      attentionService: attention,
    });

    const req = { method: "eth_requestAccounts", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];

    await middleware(req, res, next, end);

    expect(next).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
    const [error] = end.mock.calls[0] ?? [];
    expect((error as any)?.reason).toBe(ArxReasons.SessionLocked);
    expect(attention.requestAttention).toHaveBeenCalledWith({
      reason: "unlock_required",
      origin: ORIGIN,
      method: "eth_requestAccounts",
      chainRef: null,
      namespace: null,
    });
  });

  it("allows approvalRequired methods while locked (queues approval flow)", async () => {
    const next = createNextStub();
    const attention = createAttentionHelpers();
    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      findMethodDefinition: () => ({ scope: PermissionScopes.Accounts, approvalRequired: true }),
      getPassthroughAllowance: defaultPassthroughAllowance,
      attentionService: attention,
    });

    const req = { method: "eth_requestAccounts", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).toHaveBeenCalledTimes(1);
    expect(attention.requestAttention).not.toHaveBeenCalled();
  });

  it("does not bypass explicit locked deny for approvalRequired methods", async () => {
    const next = createNextStub();
    const attention = createAttentionHelpers();
    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      findMethodDefinition: () => ({
        scope: PermissionScopes.Accounts,
        approvalRequired: true,
        locked: { allow: false },
      }),
      getPassthroughAllowance: defaultPassthroughAllowance,
      attentionService: attention,
    });

    const req = { method: "eth_requestAccounts", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
    const [error] = end.mock.calls[0] ?? [];
    expect((error as any)?.reason).toBe(ArxReasons.SessionLocked);
    expect(attention.requestAttention).toHaveBeenCalledWith({
      reason: "unlock_required",
      origin: ORIGIN,
      method: "eth_requestAccounts",
      chainRef: null,
      namespace: null,
    });
  });
});
