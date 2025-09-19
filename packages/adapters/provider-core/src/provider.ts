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
  #listenersBound = false;

  constructor({ transport }: { transport: Transport }) {
    super();
    this.#transport = transport;
    this.#transport.on("connect", this.#handleTransportConnect);
    this.#transport.on("disconnect", this.#handleTransportDisconnect);
    this.#transport.on("accountsChanged", this.#handleTransportAccountsChanged);
    this.#transport.on("chainChanged", this.#handleTransportChainChanged);
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

  #updateChain(chainId: string | null) {
    this.#chainId = chainId;
  }

  #updateAccounts(accounts: string[]) {
    this.#accounts = accounts;
  }

  #handleTransportConnect = (payload: unknown) => {
    const data = (payload ?? {}) as Partial<{ chainId: string; accounts: string[]; isUnlocked: boolean }>;
    if (data.chainId) this.#updateChain(data.chainId);
    if (Array.isArray(data.accounts)) this.#updateAccounts(data.accounts);
    this.#markInitialized();
    if (this.#chainId) this.emit("connect", { chainId: this.#chainId });
    if (this.#accounts.length) this.emit("accountsChanged", [...this.#accounts]);
  };

  #handleTransportChainChanged = (chainId: unknown) => {
    if (typeof chainId !== "string") return;
    this.#updateChain(chainId);
    this.emit("chainChanged", chainId);
  };

  #handleTransportAccountsChanged = (accounts: unknown) => {
    if (!Array.isArray(accounts)) return;
    const next = accounts.filter((item): item is string => typeof item === "string");
    this.#updateAccounts(next);
    this.emit("accountsChanged", [...this.#accounts]);
  };

  #handleTransportDisconnect = (error?: unknown) => {
    this.#initialized = false;
    this.#updateChain(null);
    this.#updateAccounts([]);
    this.emit("disconnect", error);
  };
  request = async (args: RequestArguments) => {
    return this.#transport.request(args);
  };

  destroy() {
    this.#transport.removeListener("connect", this.#handleTransportConnect);
    this.#transport.removeListener("disconnect", this.#handleTransportDisconnect);
    this.#transport.removeListener("accountsChanged", this.#handleTransportAccountsChanged);
    this.#transport.removeListener("chainChanged", this.#handleTransportChainChanged);
    this.removeAllListeners();
  }
}
