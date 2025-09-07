import type { EIP1193Provider, RequestArguments } from "./types/eip1193.js";
import type { JsonRpcRequest, Transport } from "./types/transport.js";

export class EthereumProvider implements EIP1193Provider {
  #transport: Transport;

  isMetaMask = true;

  #id = 0n;

  isConnected = () => {
    return this.#transport.isConnected();
  };

  constructor({ transport }: { transport: Transport }) {
    this.#transport = transport;
  }

  request = async (args: RequestArguments) => {
    const { method, params = [] } = args;

    const request: JsonRpcRequest = {
      id: `${this.#id++}`,
      jsonrpc: "2.0",
      method,
      params,
    };
    const response = await this.#transport.send(request);

    if ("error" in response) {
      const e = Object.assign(new Error(response.error.message), {
        code: response.error.code,
        data: response.error.data,
      });
      throw e;
    }

    return response.result;
  };

  on = (event: string, listener: (...args: unknown[]) => void) => {
    this.#transport.on(event, listener);
  };

  removeListener(event: string, listener: (...args: unknown[]) => void) {
    this.#transport.removeListener(event, listener);
  }
}
