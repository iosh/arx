import { describe, expect, it, vi } from "vitest";
import { createLockedGuardMiddleware } from "./lockedGuard.js";

const ORIGIN = "https://dapp.example";

const createErrorHelpers = () => {
  const error = new Error("unauthorized");
  const unauthorized = vi.fn(() => error);
  const resolveProviderErrors = vi.fn(() => ({ unauthorized }));
  return { error, unauthorized, resolveProviderErrors };
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
    const helpers = createErrorHelpers();

    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: (origin) => origin === ORIGIN,
      resolveMethodDefinition: () => undefined,
      resolveLockedPolicy: () => undefined,
      resolvePassthroughAllowance: defaultPassthroughAllowance,
      resolveProviderErrors: helpers.resolveProviderErrors,
    });

    const req = { method: "eth_chainId", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).toHaveBeenCalledTimes(1);
    expect(helpers.resolveProviderErrors).not.toHaveBeenCalled();
    expect(helpers.unauthorized).not.toHaveBeenCalled();
  });

  it("allows unlocked sessions", async () => {
    const next = createNextStub();
    const helpers = createErrorHelpers();

    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => true,
      isInternalOrigin: () => false,
      resolveMethodDefinition: () => undefined,
      resolveLockedPolicy: () => undefined,
      resolvePassthroughAllowance: defaultPassthroughAllowance,
      resolveProviderErrors: helpers.resolveProviderErrors,
    });

    const req = { method: "eth_chainId", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).toHaveBeenCalledTimes(1);
    expect(helpers.resolveProviderErrors).not.toHaveBeenCalled();
    expect(helpers.unauthorized).not.toHaveBeenCalled();
  });

  it("rejects when method definition is missing", async () => {
    const next = createNextStub();
    const end = vi.fn();
    const helpers = createErrorHelpers();
    const resolveMethodDefinition = vi.fn(() => undefined);

    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      resolveMethodDefinition,
      resolveLockedPolicy: () => undefined,
      resolvePassthroughAllowance: defaultPassthroughAllowance,
      resolveProviderErrors: helpers.resolveProviderErrors,
    });

    const req = { method: "eth_unknown", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];

    await middleware(req, res, next, end);

    expect(next).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith(helpers.error);
    expect(resolveMethodDefinition).toHaveBeenCalledWith("eth_unknown", undefined);
    expect(helpers.resolveProviderErrors).toHaveBeenCalledTimes(1);
    expect(helpers.unauthorized).toHaveBeenCalledWith({
      message: "Request eth_unknown is blocked until the active namespace declares it",
      data: { origin: ORIGIN, method: "eth_unknown" },
    });
  });
  it("allows methods without scope", async () => {
    const next = createNextStub();
    const helpers = createErrorHelpers();

    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      resolveMethodDefinition: () => ({}),
      resolveLockedPolicy: () => undefined,
      resolvePassthroughAllowance: defaultPassthroughAllowance,
      resolveProviderErrors: helpers.resolveProviderErrors,
    });

    const req = { method: "eth_chainId", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).toHaveBeenCalledTimes(1);
    expect(helpers.resolveProviderErrors).not.toHaveBeenCalled();
    expect(helpers.unauthorized).not.toHaveBeenCalled();
  });

  it("allows methods when locked.allow is true", async () => {
    const next = createNextStub();
    const helpers = createErrorHelpers();

    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      resolveMethodDefinition: () => ({ scope: "accounts", locked: { allow: true } }),
      resolveLockedPolicy: () => undefined,
      resolvePassthroughAllowance: defaultPassthroughAllowance,
      resolveProviderErrors: helpers.resolveProviderErrors,
    });

    const req = { method: "eth_chainId", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).toHaveBeenCalledTimes(1);
    expect(helpers.resolveProviderErrors).not.toHaveBeenCalled();
    expect(helpers.unauthorized).not.toHaveBeenCalled();
  });

  it("returns locked.response payload", async () => {
    const next = createNextStub();
    const helpers = createErrorHelpers();

    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      resolveMethodDefinition: () => ({ scope: "accounts", locked: { response: ["0x123"] } }),
      resolveLockedPolicy: () => undefined,
      resolvePassthroughAllowance: defaultPassthroughAllowance,
      resolveProviderErrors: helpers.resolveProviderErrors,
    });

    const req = { method: "eth_accounts", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).not.toHaveBeenCalled();
    expect(res.result).toEqual(["0x123"]);
    expect(helpers.resolveProviderErrors).not.toHaveBeenCalled();
  });

  it("allows passthrough methods when allowWhenLocked is true", async () => {
    const next = createNextStub();
    const helpers = createErrorHelpers();

    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      resolveMethodDefinition: () => undefined,
      resolveLockedPolicy: () => undefined,
      resolvePassthroughAllowance: () => ({ isPassthrough: true, allowWhenLocked: true }),
      resolveProviderErrors: helpers.resolveProviderErrors,
    });

    const req = { method: "eth_blockNumber", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).toHaveBeenCalledTimes(1);
    expect(helpers.resolveProviderErrors).not.toHaveBeenCalled();
  });

  it("rejects passthrough methods that require unlocked sessions", async () => {
    const next = createNextStub();
    const helpers = createErrorHelpers();

    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      resolveMethodDefinition: () => undefined,
      resolveLockedPolicy: () => undefined,
      resolvePassthroughAllowance: () => ({ isPassthrough: true, allowWhenLocked: false }),
      resolveProviderErrors: helpers.resolveProviderErrors,
    });

    const req = { method: "eth_newFilter", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];
    const end = vi.fn();
    await middleware(req, res, next, end);

    expect(next).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledWith(helpers.error);
    expect(helpers.unauthorized).toHaveBeenCalledWith({
      message: "Request eth_newFilter requires an unlocked session",
      data: { origin: ORIGIN, method: "eth_newFilter" },
    });
  });

  it("rejects scoped methods by default", async () => {
    const next = createNextStub();
    const end = vi.fn();
    const helpers = createErrorHelpers();

    const middleware = createLockedGuardMiddleware({
      isUnlocked: () => false,
      isInternalOrigin: () => false,
      resolveMethodDefinition: () => ({ scope: "accounts" }),
      resolveLockedPolicy: () => undefined,
      resolvePassthroughAllowance: defaultPassthroughAllowance,
      resolveProviderErrors: helpers.resolveProviderErrors,
    });

    const req = { method: "eth_requestAccounts", origin: ORIGIN } as unknown as Parameters<typeof middleware>[0];
    const res = {} as Parameters<typeof middleware>[1];

    await middleware(req, res, next, end);

    expect(next).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith(helpers.error);
    expect(helpers.resolveProviderErrors).toHaveBeenCalledTimes(1);
    expect(helpers.unauthorized).toHaveBeenCalledWith({
      message: "Request eth_requestAccounts requires an unlocked session",
      data: { origin: ORIGIN, method: "eth_requestAccounts" },
    });
  });
});
