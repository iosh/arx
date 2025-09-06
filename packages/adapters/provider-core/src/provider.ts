import type { EIP1193Provider, RequestArguments } from "./types/eip1193.js";
import type { Transport } from "./types/transport.js";

export class EthereumProvider implements EIP1193Provider {
  #transport: Transport;

  isMetaMask = true;

  isConnected = () => {
    return this.#transport.isConnected();
  };

  constructor({ transport }: { transport: Transport }) {
    this.#transport = transport;
  }

  request = (args: RequestArguments) => {
    const { method, params = [] } = args;

    return this.#transport.request({
      method,
      params,
    });
  };

  on = (event: string, listener: (...args: unknown[]) => void) => {
    this.#transport.on(event, listener);
  };

  removeListener(event: string, listener: (...args: unknown[]) => void): void {
    this.#transport.removeListener(event, listener);
  }
}
