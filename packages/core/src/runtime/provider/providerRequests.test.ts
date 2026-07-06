import { describe, expect, it, vi } from "vitest";
import { createProviderRequests } from "./providerRequests.js";

const REQUEST_SCOPE = {
  transport: "provider" as const,
  origin: "https://dapp.example",
  portId: "port-1",
  sessionId: "11111111-1111-4111-8111-111111111111",
};

describe("createProviderRequests", () => {
  it("cancels only the matched request scope", async () => {
    const generatedIds = ["request-1", "request-2"];
    const providerRequests = createProviderRequests({
      generateId: () => generatedIds.shift() ?? "unexpected-request-id",
      now: () => 100,
    });

    const targetHandle = providerRequests.beginRequest({
      scope: REQUEST_SCOPE,
      rpcId: "rpc-1",
      namespace: "eip155",
      method: "eth_requestAccounts",
    });
    const siblingHandle = providerRequests.beginRequest({
      scope: { ...REQUEST_SCOPE, sessionId: "22222222-2222-4222-8222-222222222222" },
      rpcId: "rpc-2",
      namespace: "eip155",
      method: "eth_requestAccounts",
    });

    await expect(providerRequests.cancelScope(REQUEST_SCOPE, "caller_disconnected")).resolves.toBe(1);

    expect(providerRequests.has("request-1")).toBe(false);
    expect(providerRequests.has("request-2")).toBe(true);
    expect(targetHandle.getTerminalError()).toMatchObject({
      code: "global.transport.disconnected",
    });
    expect(siblingHandle.getTerminalError()).toBeNull();
  });

  it("turns late completion into a no-op after the request scope was cancelled", async () => {
    const providerRequests = createProviderRequests({
      generateId: () => "request-2",
      now: () => 200,
    });

    const handle = providerRequests.beginRequest({
      scope: REQUEST_SCOPE,
      rpcId: "rpc-fast",
      namespace: "eip155",
      method: "eth_chainId",
    });

    await expect(providerRequests.cancelScope(REQUEST_SCOPE, "caller_disconnected")).resolves.toBe(1);

    expect(handle.fulfill()).toBe(false);
    expect(handle.reject()).toBe(false);
    expect(handle.getTerminalError()).toMatchObject({
      code: "global.transport.disconnected",
    });
  });

  it("keeps a cancelled request terminal even if completion arrives later", async () => {
    const providerRequests = createProviderRequests({
      generateId: () => "request-5",
      now: () => 500,
    });

    const handle = providerRequests.beginRequest({
      scope: REQUEST_SCOPE,
      rpcId: "rpc-send-fail",
      namespace: "eip155",
      method: "eth_sendTransaction",
    });

    await expect(providerRequests.cancelScope(REQUEST_SCOPE, "caller_disconnected")).resolves.toBe(1);

    expect(handle.reject()).toBe(false);
    expect(handle.getTerminalError()).toMatchObject({
      code: "global.transport.disconnected",
    });
    expect(providerRequests.has("request-5")).toBe(false);
  });

  it("keeps listPending in createdAt order", () => {
    const generatedIds = ["request-b", "request-a"];
    const providerRequests = createProviderRequests({
      generateId: () => generatedIds.shift() ?? "unexpected-id",
      now: vi.fn().mockReturnValueOnce(200).mockReturnValueOnce(100),
    });

    providerRequests.beginRequest({
      scope: REQUEST_SCOPE,
      rpcId: "rpc-b",
      namespace: "eip155",
      method: "personal_sign",
    });
    providerRequests.beginRequest({
      scope: REQUEST_SCOPE,
      rpcId: "rpc-a",
      namespace: "eip155",
      method: "eth_chainId",
    });

    expect(providerRequests.listPending().map((record) => record.id)).toEqual(["request-a", "request-b"]);
  });
});
