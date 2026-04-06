import { EventEmitter } from "eventemitter3";
import type { RequestArguments } from "../../types/eip1193.js";
import type { Transport, TransportMeta } from "../../types/transport.js";
import type { ProviderPatch, ProviderSnapshot } from "./state.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type RequestHandler = (args: RequestArguments) => Promise<unknown>;

const unimplemented: RequestHandler = async ({ method }) => {
  throw new Error(
    `StubTransport: request handler not implemented for method "${method}". ` +
      `Use transport.setRequestHandler() to mock this method.`,
  );
};

export class StubTransport extends EventEmitter implements Transport<ProviderSnapshot, ProviderPatch> {
  #snapshot: ProviderSnapshot;
  #requestHandler: RequestHandler = unimplemented;
  #bootstrapHandler: () => Promise<ProviderSnapshot>;

  constructor(initial: ProviderSnapshot) {
    super();
    this.#snapshot = clone(initial);
    this.#bootstrapHandler = async () => clone(this.#snapshot);
  }

  bootstrap = async () => this.#bootstrapHandler();
  disconnect = async () => {};

  isConnected = () => {
    return this.#snapshot.connected;
  };

  request = async (args: RequestArguments, _options?: { timeoutMs?: number }) => {
    return this.#requestHandler(args);
  };

  setBootstrapHandler(handler: () => Promise<ProviderSnapshot>) {
    this.#bootstrapHandler = handler;
  }

  updateSnapshot(snapshot: Partial<ProviderSnapshot>) {
    this.#snapshot = { ...this.#snapshot, ...snapshot };
  }

  setRequestHandler(handler: RequestHandler) {
    this.#requestHandler = handler;
  }
}

export const buildMeta = (overrides?: Partial<TransportMeta>): TransportMeta => ({
  activeChainByNamespace: { eip155: "eip155:1" },
  supportedChains: ["eip155:1"],
  ...overrides,
});
