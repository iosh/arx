import { evmRpcErrors } from "@arx/provider-core/errors";
import type { JsonRpcResponse } from "@arx/provider-core/types";
import { CHANNEL } from "@arx/provider-extension/constants";
import type { Envelope } from "@arx/provider-extension/types";
import browser from "webextension-polyfill";
import { defineBackground } from "wxt/utils/define-background";

const DEFAULT_CHAIN = { chainId: "0x1", caip2: "eip155:1" };
const DEFAULT_ACCOUNTS = ["0x0000000000000000000000000000000000000001"];

const providerState = {
  chainId: DEFAULT_CHAIN.chainId,
  accounts: [...DEFAULT_ACCOUNTS],
};

const getState = () => providerState;

const postEnvelope = (port: browser.Runtime.Port, envelope: Envelope) => {
  port.postMessage(envelope);
};

const emitEvent = (port: browser.Runtime.Port, event: string, params: unknown[]) => {
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

const setChain = (port: browser.Runtime.Port, chainId: string) => {
  if (providerState.chainId !== chainId) {
    providerState.chainId = chainId;
    emitEvent(port, "chainChanged", [chainId]);
  }
};

const setAccounts = (port: browser.Runtime.Port, accounts: string[]) => {
  const next = accounts.filter((item) => typeof item === "string");
  if (JSON.stringify(providerState.accounts) === JSON.stringify(next)) return;
  providerState.accounts = next;
  emitEvent(port, "accountsChanged", [next]);
};

export default defineBackground(() => {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== CHANNEL) return;

    const handleHandshake = () => {
      const current = getState();
      postEnvelope(port, {
        channel: CHANNEL,
        type: "handshake_ack",
        payload: {
          chainId: current.chainId,
          accounts: current.accounts,
          isUnlocked: true,
        },
      });
    };

    const initialState = getState();

    emitEvent(port, "accountsChanged", [initialState.accounts]);
    emitEvent(port, "chainChanged", [initialState.chainId]);

    const handleMessage = (message: unknown) => {
      const envelope = message as Envelope | undefined;
      if (!envelope || envelope.channel !== CHANNEL) return;

      switch (envelope.type) {
        case "handshake":
          handleHandshake();
          break;
        case "request": {
          const { id: rpcId, jsonrpc, method } = envelope.payload;
          const state = getState();
          const respond = (result: unknown) => {
            replyRequest(port, envelope.id, { id: rpcId, jsonrpc, result });
          };

          const respondMethodNotFound = () => {
            const error = evmRpcErrors.methodNotFound({
              message: `The method ${method} does not exist/is not available`,
              data: { method },
            });
            replyRequest(port, envelope.id, {
              id: rpcId,
              jsonrpc,
              error: error.serialize(),
            });
          };

          switch (method) {
            case "eth_chainId":
              respond(state.chainId);
              break;
            case "eth_accounts":
              respond(state.accounts);
              break;
            case "eth_requestAccounts": {
              const next = state.accounts.length ? state.accounts : DEFAULT_ACCOUNTS;
              setAccounts(port, next);
              respond(next);
              break;
            }
            default:
              respondMethodNotFound();
              break;
          }

          break;
        }
        default:
          break;
      }
    };

    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(() => {
      port.onMessage.removeListener(handleMessage);
    });
  });
});
