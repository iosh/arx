import { EventEmitter } from "eventemitter3";
import type { EIP1193Provider, RequestArguments } from "./types/eip1193.js";
import type { Transport } from "./types/transport.js";

const PROVIDER_INFO = {
  uuid: "90ef60ca-8ea5-4638-b577-6990dc93ef2f",
  name: "ARX Wallet",
  icon: "data:image/svg+xml;base64,...",
  rdns: "wallet.arx",
} as const;

export class EthereumProvider extends EventEmitter implements EIP1193Provider {
  constructor({ transport }: { transport: Transport }) {
    super();
    this.#transport = transport;
  }
  static readonly providerInfo = PROVIDER_INFO;

  readonly isArx = true;

  #transport: Transport;
  #chainId: string | null = null;

  #accounts: string[] = [];

  #initialized = false;

  isConnected = () => {
    return this.#transport.isConnected();
  };

  get chainId() {
    return this.#chainId;
  }

  get selectedAddress() {
    return this.#accounts[0] ?? null;
  }

  #markInitialized() {
    if (!this.#initialized) {
      this.#initialized = true;
      this.emit("_initialized");
    }
  }

  #updateChain({ chainId }: { chainId: string }) {
    this.#chainId = chainId;
  }

  #updateAccounts(accounts: string[]) {
    this.#accounts = accounts;
  }

  request = async (args: RequestArguments) => {
    return this.#transport.request(args);
  };
}
