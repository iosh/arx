import { EventEmitter } from "eventemitter3";
import type { RequestArguments } from "../../types/eip1193.js";
import type { Transport, TransportMeta, TransportState } from "../../types/transport.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type RequestHandler = (args: RequestArguments) => Promise<unknown>;

const unimplemented: RequestHandler = async ({ method }) => {
  throw new Error(
    `StubTransport: request handler not implemented for method "${method}". ` +
      `Use transport.setRequestHandler() to mock this method.`,
  );
};

export class StubTransport extends EventEmitter implements Transport {
  #state: TransportState;
  #requestHandler: RequestHandler = unimplemented;

  constructor(initial: TransportState) {
    super();
    this.#state = clone(initial);
  }

  connect = async () => {};
  disconnect = async () => {};

  isConnected = () => {
    return this.#state.connected;
  };

  getConnectionState(): TransportState {
    return clone(this.#state);
  }

  request = async (args: RequestArguments, _options?: { timeoutMs?: number }) => {
    return this.#requestHandler(args);
  };

  updateState(state: Partial<TransportState>) {
    this.#state = { ...this.#state, ...state };
  }

  setRequestHandler(handler: RequestHandler) {
    this.#requestHandler = handler;
  }
}

export const buildMeta = (overrides?: Partial<TransportMeta>): TransportMeta => ({
  activeChain: "eip155:1",
  activeNamespace: "eip155",
  supportedChains: ["eip155:1"],
  ...overrides,
});
