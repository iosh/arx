import { ArxReasons } from "@arx/errors";
import { describe, expect, it, vi } from "vitest";
import { createProviderRequests } from "./providerRequests.js";

const REQUEST_SCOPE = {
  transport: "provider" as const,
  origin: "https://dapp.example",
  portId: "port-1",
  sessionId: "11111111-1111-4111-8111-111111111111",
};

describe("createProviderRequests", () => {
  it("cancels only the matched request scope and precisely expires the linked approval", async () => {
    const cancelApproval = vi.fn(async () => {});
    const generatedIds = ["request-1", "request-2", "approval-1"];
    const providerRequests = createProviderRequests({
      generateId: () => generatedIds.shift() ?? "unexpected-request-id",
      now: () => 100,
      cancelApproval,
    });

    const targetHandle = providerRequests.beginRequest({
      scope: REQUEST_SCOPE,
      rpcId: "rpc-1",
      providerNamespace: "eip155",
      method: "eth_requestAccounts",
    });
    const siblingHandle = providerRequests.beginRequest({
      scope: { ...REQUEST_SCOPE, sessionId: "22222222-2222-4222-8222-222222222222" },
      rpcId: "rpc-2",
      providerNamespace: "eip155",
      method: "eth_requestAccounts",
    });

    targetHandle.attachBlockingApproval(({ id }) => ({
      id,
      settled: new Promise<never>(() => {}),
    }));

    await expect(providerRequests.cancelScope(REQUEST_SCOPE, "session_lost")).resolves.toBe(1);

    expect(cancelApproval).toHaveBeenCalledTimes(1);
    expect(cancelApproval).toHaveBeenCalledWith({
      id: "approval-1",
      reason: "session_lost",
    });
    expect(providerRequests.has("request-1")).toBe(false);
    expect(providerRequests.has("request-2")).toBe(true);
    expect(targetHandle.getTerminalError()).toMatchObject({
      reason: ArxReasons.TransportDisconnected,
    });
    expect(siblingHandle.getTerminalError()).toBeNull();
  });

  it("turns late completion into a no-op after the request scope was cancelled", async () => {
    const providerRequests = createProviderRequests({
      generateId: () => "request-2",
      now: () => 200,
      cancelApproval: async () => {},
    });

    const handle = providerRequests.beginRequest({
      scope: REQUEST_SCOPE,
      rpcId: "rpc-fast",
      providerNamespace: "eip155",
      method: "eth_chainId",
    });

    await expect(providerRequests.cancelScope(REQUEST_SCOPE, "session_lost")).resolves.toBe(1);

    expect(handle.fulfill()).toBe(false);
    expect(handle.reject()).toBe(false);
    expect(handle.getTerminalError()).toMatchObject({
      reason: ArxReasons.TransportDisconnected,
    });
  });

  it("does not resurrect a request when it is cancelled while creating the blocking approval", async () => {
    const cancelApproval = vi.fn(async () => {});
    const generatedIds = ["request-3", "approval-3"];
    const providerRequests = createProviderRequests({
      generateId: () => generatedIds.shift() ?? "unexpected-id",
      now: () => 300,
      cancelApproval,
    });

    const handle = providerRequests.beginRequest({
      scope: REQUEST_SCOPE,
      rpcId: "rpc-3",
      providerNamespace: "eip155",
      method: "personal_sign",
    });

    let cancelPromise: Promise<boolean> | null = null;
    const approvalHandle = handle.attachBlockingApproval(({ id, createdAt }) => {
      expect(createdAt).toBe(300);
      expect(providerRequests.get("request-3")).toMatchObject({
        id: "request-3",
        blockingApprovalId: id,
      });
      cancelPromise = handle.cancel("session_lost");

      return {
        id,
        settled: new Promise<never>(() => {}),
      };
    });

    expect(approvalHandle.id).toBe("approval-3");
    await expect(cancelPromise).resolves.toBe(true);
    expect(cancelApproval).toHaveBeenCalledTimes(1);
    expect(cancelApproval).toHaveBeenCalledWith({
      id: "approval-3",
      reason: "session_lost",
    });
    expect(providerRequests.has("request-3")).toBe(false);
    expect(providerRequests.get("request-3")).toBeUndefined();
    expect(providerRequests.listPending()).toEqual([]);
    expect(handle.getTerminalError()).toMatchObject({
      reason: ArxReasons.TransportDisconnected,
    });
  });
});
