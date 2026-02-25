import { ArxReasons, arxError } from "@arx/errors";
import { JsonRpcEngine } from "@metamask/json-rpc-engine";
import { describe, expect, it, vi } from "vitest";
import { PermissionCapabilities } from "../../../controllers/permission/types.js";
import type { MethodDefinition } from "../../../rpc/handlers/types.js";
import type { RpcInvocationContext } from "../../../rpc/index.js";
import { createAccessPolicyGuardMiddleware } from "./accessPolicyGuard.js";
import { createInvocationContextMiddleware } from "./invocationContext.js";

const ORIGINS = {
  internal: "chrome-extension://arx",
  external: "https://dapp.example",
};

const run = async (args: {
  origin: string;
  method: string;
  context?: RpcInvocationContext;
  resolve: (
    method: string,
    ctx?: RpcInvocationContext,
  ) => {
    namespace: string;
    chainRef: "eip155:1";
    definition: MethodDefinition | undefined;
    passthrough: { isPassthrough: boolean; allowWhenLocked: boolean };
  };
  guard: Parameters<typeof createAccessPolicyGuardMiddleware>[0];
}) => {
  const engine = new JsonRpcEngine();

  engine.push(
    createInvocationContextMiddleware({
      resolve: args.resolve,
    }),
  );
  engine.push(createAccessPolicyGuardMiddleware(args.guard));

  const handler = vi.fn((_req, res, _next, end) => {
    res.result = "ok";
    end();
  });
  engine.push(handler);

  const request = {
    id: 1,
    jsonrpc: "2.0",
    method: args.method,
    origin: args.origin,
    ...(args.context ? { arx: args.context } : {}),
  } as const;

  await new Promise<void>((resolve, reject) => {
    engine.handle(request as unknown as Parameters<JsonRpcEngine["handle"]>[0], (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return { handler };
};

describe("createAccessPolicyGuardMiddleware", () => {
  it("skips internal origins", async () => {
    const attention = vi.fn();
    await expect(
      run({
        origin: ORIGINS.internal,
        method: "eth_chainId",
        resolve: () => ({
          namespace: "eip155",
          chainRef: "eip155:1",
          definition: { handler: vi.fn() },
          passthrough: { isPassthrough: false, allowWhenLocked: false },
        }),
        guard: {
          isUnlocked: () => false,
          isInternalOrigin: (origin) => origin === ORIGINS.internal,
          requestAttention: attention,
          assertPermission: vi.fn(async () => {
            throw new Error("should not run");
          }),
          isConnected: vi.fn(() => false),
        },
      }),
    ).resolves.toBeDefined();
    expect(attention).not.toHaveBeenCalled();
  });

  it("throws RpcMethodNotFound when definition is missing and not passthrough", async () => {
    const attention = vi.fn();
    await expect(
      run({
        origin: ORIGINS.external,
        method: "eth_unknown",
        resolve: () => ({
          namespace: "eip155",
          chainRef: "eip155:1",
          definition: undefined,
          passthrough: { isPassthrough: false, allowWhenLocked: false },
        }),
        guard: {
          isUnlocked: () => true,
          isInternalOrigin: () => false,
          requestAttention: attention,
          assertPermission: vi.fn(async () => {}),
          isConnected: vi.fn(() => false),
        },
      }),
    ).rejects.toMatchObject({ reason: ArxReasons.RpcMethodNotFound });
    expect(attention).not.toHaveBeenCalled();
  });

  it("rejects passthrough methods that require unlocked sessions", async () => {
    const attention = vi.fn();
    await expect(
      run({
        origin: ORIGINS.external,
        method: "eth_newFilter",
        resolve: () => ({
          namespace: "eip155",
          chainRef: "eip155:1",
          definition: undefined,
          passthrough: { isPassthrough: true, allowWhenLocked: false },
        }),
        guard: {
          isUnlocked: () => false,
          isInternalOrigin: () => false,
          requestAttention: attention,
          shouldRequestUnlockAttention: () => true,
          assertPermission: vi.fn(async () => {}),
          isConnected: vi.fn(() => false),
        },
      }),
    ).rejects.toMatchObject({ reason: ArxReasons.SessionLocked });
    expect(attention).toHaveBeenCalledWith({
      reason: "unlock_required",
      origin: ORIGINS.external,
      method: "eth_newFilter",
      chainRef: "eip155:1",
      namespace: "eip155",
    });
  });

  it("returns locked.type=response payload without executing handler", async () => {
    const attention = vi.fn();
    const result = await run({
      origin: ORIGINS.external,
      method: "eth_accounts",
      resolve: () => ({
        namespace: "eip155",
        chainRef: "eip155:1",
        definition: {
          scope: PermissionCapabilities.Accounts,
          locked: { type: "response", response: [] },
          handler: vi.fn(),
        },
        passthrough: { isPassthrough: false, allowWhenLocked: false },
      }),
      guard: {
        isUnlocked: () => false,
        isInternalOrigin: () => false,
        requestAttention: attention,
        assertPermission: vi.fn(async () => {}),
        isConnected: vi.fn(() => false),
      },
    });
    expect(result.handler).not.toHaveBeenCalled();
    expect(attention).not.toHaveBeenCalled();
  });

  it("denies scoped methods by default when locked", async () => {
    const attention = vi.fn();
    await expect(
      run({
        origin: ORIGINS.external,
        method: "eth_requestAccounts",
        resolve: () => ({
          namespace: "eip155",
          chainRef: "eip155:1",
          definition: { scope: PermissionCapabilities.Accounts, handler: vi.fn() },
          passthrough: { isPassthrough: false, allowWhenLocked: false },
        }),
        guard: {
          isUnlocked: () => false,
          isInternalOrigin: () => false,
          requestAttention: attention,
          shouldRequestUnlockAttention: () => true,
          assertPermission: vi.fn(async () => {}),
          isConnected: vi.fn(() => false),
        },
      }),
    ).rejects.toMatchObject({ reason: ArxReasons.SessionLocked });
    expect(attention).toHaveBeenCalled();
  });

  it("enforces connected check when permissionCheck is connected", async () => {
    const attention = vi.fn();
    await expect(
      run({
        origin: ORIGINS.external,
        method: "personal_sign",
        context: { namespace: "eip155", chainRef: "eip155:1" },
        resolve: () => ({
          namespace: "eip155",
          chainRef: "eip155:1",
          definition: {
            scope: PermissionCapabilities.Sign,
            permissionCheck: "connected",
            locked: { type: "allow" },
            handler: vi.fn(),
          },
          passthrough: { isPassthrough: false, allowWhenLocked: false },
        }),
        guard: {
          isUnlocked: () => true,
          isInternalOrigin: () => false,
          requestAttention: attention,
          assertPermission: vi.fn(async () => {}),
          isConnected: vi.fn(() => false),
        },
      }),
    ).rejects.toMatchObject({ reason: ArxReasons.PermissionNotConnected });
  });

  it("enforces scope permission checks", async () => {
    const attention = vi.fn();
    await expect(
      run({
        origin: ORIGINS.external,
        method: "eth_accounts",
        resolve: () => ({
          namespace: "eip155",
          chainRef: "eip155:1",
          definition: {
            scope: PermissionCapabilities.Accounts,
            locked: { type: "allow" },
            handler: vi.fn(),
          },
          passthrough: { isPassthrough: false, allowWhenLocked: false },
        }),
        guard: {
          isUnlocked: () => true,
          isInternalOrigin: () => false,
          requestAttention: attention,
          assertPermission: vi.fn(async () => {
            throw arxError({ reason: ArxReasons.PermissionDenied, message: "nope" });
          }),
          isConnected: vi.fn(() => true),
        },
      }),
    ).rejects.toMatchObject({ reason: ArxReasons.PermissionDenied });
  });
});
