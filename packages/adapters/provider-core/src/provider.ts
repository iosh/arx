import type { EIP1193Provider, RequestArguments } from "./types/eip1193.js";
import type { Transport } from "./types/transport.js";

export class EthereumProvider implements EIP1193Provider {
  #transport: Transport;

  isConnected = () => {
    return this.#transport.isConnected();
  };

  constructor({ transport }: { transport: Transport }) {
    this.#transport = transport;
  }

  request = async (args: RequestArguments) => {
    return this.#transport.request(args);
  };

  on = (event: string, listener: (...args: unknown[]) => void) => {
    this.#transport.on(event, listener);
  };

  removeListener(event: string, listener: (...args: unknown[]) => void) {
    this.#transport.removeListener(event, listener);
  }
}
