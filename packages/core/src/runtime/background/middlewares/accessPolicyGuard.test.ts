import { ArxReasons } from "@arx/errors";
import { JsonRpcEngine } from "@metamask/json-rpc-engine";
import { describe, expect, it, vi } from "vitest";
import {
  ApprovalRequirements,
  AuthorizationRequirements,
  AuthorizedScopeChecks,
  type MethodDefinition,
} from "../../../rpc/handlers/types.js";
import type { RpcInvocationContext } from "../../../rpc/index.js";
import { RpcRequestKinds } from "../../../rpc/requestKind.js";
import { createAccessPolicyGuardMiddleware } from "./accessPolicyGuard.js";
import { createInvocationContextMiddleware } from "./invocationContext.js";

const ORIGINS = {
  internal: "chrome-extension://arx",
  external: "https://dapp.example",
};

const buildMethodDefinition = (overrides: Partial<MethodDefinition> = {}): MethodDefinition => ({
  authorizationRequirement: AuthorizationRequirements.None,
  approvalRequirement: ApprovalRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  handler: vi.fn(),
  ...overrides,
});

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
          definition: buildMethodDefinition(),
          passthrough: { isPassthrough: false, allowWhenLocked: false },
        }),
        guard: {
          isUnlocked: () => false,
          isInternalOrigin: (origin) => origin === ORIGINS.internal,
          requestAttention: attention,
          isAuthorized: vi.fn(() => false),
        },
      }),
    ).resolves.toBeDefined();
    expect(attention).not.toHaveBeenCalled();
  });

  it("throws RpcUnsupportedMethod when definition is missing and not passthrough", async () => {
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
          isAuthorized: vi.fn(() => false),
        },
      }),
    ).rejects.toMatchObject({ reason: ArxReasons.RpcUnsupportedMethod });
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
          isAuthorized: vi.fn(() => false),
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
        definition: buildMethodDefinition({
          locked: { type: "response", response: [] },
        }),
        passthrough: { isPassthrough: false, allowWhenLocked: false },
      }),
      guard: {
        isUnlocked: () => false,
        isInternalOrigin: () => false,
        requestAttention: attention,
        isAuthorized: vi.fn(() => false),
      },
    });
    expect(result.handler).not.toHaveBeenCalled();
    expect(attention).not.toHaveBeenCalled();
  });

  it("does not infer locked denial from request kind", async () => {
    const attention = vi.fn();
    const result = await run({
      origin: ORIGINS.external,
      method: "eth_requestAccounts",
      resolve: () => ({
        namespace: "eip155",
        chainRef: "eip155:1",
        definition: buildMethodDefinition({
          requestKind: RpcRequestKinds.AccountAccess,
        }),
        passthrough: { isPassthrough: false, allowWhenLocked: false },
      }),
      guard: {
        isUnlocked: () => false,
        isInternalOrigin: () => false,
        requestAttention: attention,
        shouldRequestUnlockAttention: () => true,
        isAuthorized: vi.fn(() => false),
      },
    });
    expect(result.handler).toHaveBeenCalledTimes(1);
    expect(attention).not.toHaveBeenCalled();
  });

  it("enforces connected check when authorizationRequirement is required", async () => {
    const attention = vi.fn();
    await expect(
      run({
        origin: ORIGINS.external,
        method: "personal_sign",
        context: { namespace: "eip155", chainRef: "eip155:1" },
        resolve: () => ({
          namespace: "eip155",
          chainRef: "eip155:1",
          definition: buildMethodDefinition({
            authorizationRequirement: AuthorizationRequirements.Required,
            locked: { type: "allow" },
          }),
          passthrough: { isPassthrough: false, allowWhenLocked: false },
        }),
        guard: {
          isUnlocked: () => true,
          isInternalOrigin: () => false,
          requestAttention: attention,
          isAuthorized: vi.fn(() => false),
        },
      }),
    ).rejects.toMatchObject({ reason: ArxReasons.PermissionNotConnected });
  });

  it("does not execute approval facts in middleware", async () => {
    const attention = vi.fn();
    const result = await run({
      origin: ORIGINS.external,
      method: "wallet_requestPermissions",
      resolve: () => ({
        namespace: "eip155",
        chainRef: "eip155:1",
        definition: buildMethodDefinition({
          approvalRequirement: ApprovalRequirements.Required,
        }),
        passthrough: { isPassthrough: false, allowWhenLocked: false },
      }),
      guard: {
        isUnlocked: () => true,
        isInternalOrigin: () => false,
        requestAttention: attention,
        isAuthorized: vi.fn(() => true),
      },
    });
    expect(result.handler).toHaveBeenCalledTimes(1);
    expect(attention).not.toHaveBeenCalled();
  });
});
