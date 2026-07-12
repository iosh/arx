import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviderRequests } from "./providerRequests.js";

const REQUEST_SCOPE = {
  transport: "provider" as const,
  origin: "https://dapp.example",
  portId: "port-1",
  sessionId: "11111111-1111-4111-8111-111111111111",
};

type RandomUuid = ReturnType<typeof crypto.randomUUID>;

const REQUEST_1 = "00000000-0000-4000-8000-000000000001" as RandomUuid;
const REQUEST_2 = "00000000-0000-4000-8000-000000000002" as RandomUuid;
const REQUEST_5 = "00000000-0000-4000-8000-000000000005" as RandomUuid;
const REQUEST_A = "00000000-0000-4000-8000-00000000000a" as RandomUuid;
const REQUEST_B = "00000000-0000-4000-8000-00000000000b" as RandomUuid;

const mockRandomUUID = (ids: RandomUuid[]) => {
  const generatedIds = [...ids];
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
    const id = generatedIds.shift();
    if (!id) {
      throw new Error("Unexpected randomUUID call");
    }
    return id;
  });
};

describe("createProviderRequests", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("cancels only the matched request scope", async () => {
    mockRandomUUID([REQUEST_1, REQUEST_2]);
    const providerRequests = createProviderRequests();

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

    expect(providerRequests.has(REQUEST_1)).toBe(false);
    expect(providerRequests.has(REQUEST_2)).toBe(true);
    expect(targetHandle.getTerminalError()).toMatchObject({
      code: "provider.disconnected",
    });
    expect(siblingHandle.getTerminalError()).toBeNull();
  });

  it("turns late completion into a no-op after the request scope was cancelled", async () => {
    mockRandomUUID([REQUEST_2]);
    const providerRequests = createProviderRequests();

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
      code: "provider.disconnected",
    });
  });

  it("keeps a cancelled request terminal even if completion arrives later", async () => {
    mockRandomUUID([REQUEST_5]);
    const providerRequests = createProviderRequests();

    const handle = providerRequests.beginRequest({
      scope: REQUEST_SCOPE,
      rpcId: "rpc-send-fail",
      namespace: "eip155",
      method: "eth_sendTransaction",
    });

    await expect(providerRequests.cancelScope(REQUEST_SCOPE, "caller_disconnected")).resolves.toBe(1);

    expect(handle.reject()).toBe(false);
    expect(handle.getTerminalError()).toMatchObject({
      code: "provider.disconnected",
    });
    expect(providerRequests.has(REQUEST_5)).toBe(false);
  });

  it("keeps listPending in createdAt order", () => {
    vi.useFakeTimers();
    mockRandomUUID([REQUEST_B, REQUEST_A]);
    const providerRequests = createProviderRequests();

    vi.setSystemTime(200);
    providerRequests.beginRequest({
      scope: REQUEST_SCOPE,
      rpcId: "rpc-b",
      namespace: "eip155",
      method: "personal_sign",
    });
    vi.setSystemTime(100);
    providerRequests.beginRequest({
      scope: REQUEST_SCOPE,
      rpcId: "rpc-a",
      namespace: "eip155",
      method: "eth_chainId",
    });

    expect(providerRequests.listPending().map((record) => record.id)).toEqual([REQUEST_A, REQUEST_B]);
  });
});
