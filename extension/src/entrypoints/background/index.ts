import { evmProviderErrors, evmRpcErrors } from "@arx/provider-core/errors";
import type { EIP1193ProviderRpcError, JsonRpcResponse, JsonRpcVersion } from "@arx/provider-core/types";
import { CHANNEL } from "@arx/provider-extension/constants";
import type { Envelope } from "@arx/provider-extension/types";
import browser from "webextension-polyfill";
import { defineBackground } from "wxt/utils/define-background";

const pendingRequests = new Map<browser.Runtime.Port, Map<string, { rpcId: string; jsonrpc: JsonRpcVersion }>>();

const getPendingBucket = (port: browser.Runtime.Port) => {
  let bucket = pendingRequests.get(port);
  if (!bucket) {
    bucket = new Map();
    pendingRequests.set(port, bucket);
  }

  return bucket;
};

const clearPendingForPort = (port: browser.Runtime.Port) => {
  pendingRequests.delete(port);
};

const rejectPendingWithDisconnect = (port: browser.Runtime.Port) => {
  const bucket = pendingRequests.get(port);
  if (!bucket) return;
  const error = evmProviderErrors.disconnected().serialize();

  for (const [messageId, { rpcId, jsonrpc }] of bucket) {
    replyRequest(port, messageId, {
      id: rpcId,
      jsonrpc,
      error,
    });
  }

  clearPendingForPort(port);
};

const DEFAULT_ACCOUNTS: string[] = [];

const getDefaultChain = () => {
  // TODO: replace this with chainRegistry lookup
  return { chainId: "0x1", caip2: "eip155:1" };
};

const providerState = {
  chain: { ...getDefaultChain() },
  accounts: [...DEFAULT_ACCOUNTS],
};

const getState = () => ({
  chain: { ...providerState.chain },
  accounts: [...providerState.accounts],
});

const postEnvelope = (port: browser.Runtime.Port, envelope: Envelope) => {
  port.postMessage(envelope);
};

const emitEventToPort = (port: browser.Runtime.Port, event: string, params: unknown[]) => {
  postEnvelope(port, {
    channel: CHANNEL,
    type: "event",
    payload: { event, params },
  });
};

const replyRequest = (port: browser.Runtime.Port, id: string, payload: JsonRpcResponse) => {
  postEnvelope(port, {
    channel: CHANNEL,
    type: "response",
    id,
    payload,
  });
};

const setChain = (chain: { chainId: string; caip2: string }) => {
  if (providerState.chain.chainId === chain.chainId && providerState.chain.caip2 === chain.caip2) {
    return;
  }
  providerState.chain = { ...chain };
  broadcastEvent("chainChanged", [chain.chainId]);
};

const setAccounts = (accounts: string[]) => {
  const next = accounts.filter((item) => typeof item === "string");
  if (JSON.stringify(providerState.accounts) === JSON.stringify(next)) return;
  providerState.accounts = next;
  broadcastEvent("accountsChanged", [next]);
};

const connections = new Set<browser.Runtime.Port>();

const broadcastEvent = (event: string, params: unknown[]) => {
  for (const port of connections) {
    emitEventToPort(port, event, params);
  }
};

const createMethodNotFoundError = (method: string) =>
  evmRpcErrors.methodNotFound({
    message: `The method ${method} does not exist/is not available`,
    data: { method },
  });
type RpcHandler = (context: { port: browser.Runtime.Port }) => Promise<unknown> | unknown;

const rpcHandlers: Record<string, RpcHandler> = {
  eth_chainId: () => providerState.chain.chainId,
  eth_accounts: () => [...providerState.accounts],
  eth_requestAccounts: () => {
    const current = providerState.accounts.length ? providerState.accounts : DEFAULT_ACCOUNTS;
    setAccounts(current);
    return current;
  },
};

const toJsonRpcError = (error: unknown, method: string): EIP1193ProviderRpcError => {
  if (
    error &&
    typeof error === "object" &&
    "serialize" in error &&
    typeof (error as { serialize?: unknown }).serialize === "function"
  ) {
    return (error as { serialize: () => EIP1193ProviderRpcError }).serialize();
  }

  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "number") {
    const rpcError = error as EIP1193ProviderRpcError;
    return {
      code: rpcError.code,
      message: rpcError.message ?? "Unknown error",
      data: rpcError.data,
    };
  }

  return createMethodNotFoundError(method).serialize();
};

const handleRpcRequest = async (port: browser.Runtime.Port, envelope: Extract<Envelope, { type: "request" }>) => {
  const { id: rpcId, jsonrpc, method } = envelope.payload;
  const pendingBucket = getPendingBucket(port);
  pendingBucket.set(envelope.id, { rpcId, jsonrpc });

  const handler = rpcHandlers[method];
  if (!handler) {
    const error = createMethodNotFoundError(method);
    replyRequest(port, envelope.id, {
      id: rpcId,
      jsonrpc,
      error: error.serialize(),
    });
    return;
  }

  try {
    const result = await handler({ port });
    replyRequest(port, envelope.id, { id: rpcId, jsonrpc, result });
  } catch (error) {
    replyRequest(port, envelope.id, {
      id: rpcId,
      jsonrpc,
      error: toJsonRpcError(error, method),
    });
  } finally {
    pendingBucket.delete(envelope.id);
    if (pendingBucket.size === 0) {
      clearPendingForPort(port);
    }
  }
};

export default defineBackground(() => {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== CHANNEL) return;

    connections.add(port);

    const handleHandshake = () => {
      const current = getState();
      postEnvelope(port, {
        channel: CHANNEL,
        type: "handshake_ack",
        payload: {
          chainId: current.chain.chainId,
          caip2: current.chain.caip2,
          accounts: current.accounts,
          isUnlocked: true,
        },
      });
    };

    const handleMessage = (message: unknown) => {
      const envelope = message as Envelope | undefined;
      if (!envelope || envelope.channel !== CHANNEL) return;

      switch (envelope.type) {
        case "handshake":
          handleHandshake();
          break;
        case "request": {
          handleRpcRequest(port, envelope);
          break;
        }
        default:
          break;
      }
    };

    const handleDisconnect = () => {
      emitEventToPort(port, "disconnect", []);
      rejectPendingWithDisconnect(port);
      connections.delete(port);
      port.onMessage.removeListener(handleMessage);
      port.onDisconnect.removeListener(handleDisconnect);
    };

    const initialState = getState();

    emitEventToPort(port, "accountsChanged", [initialState.accounts]);
    emitEventToPort(port, "chainChanged", [initialState.chain.chainId]);

    port.onMessage.addListener(handleMessage);

    port.onDisconnect.addListener(handleDisconnect);
  });
});
