import type { Eip6963Info } from "../modules.js";

type Eip6963Window = Window & {
  CustomEvent: typeof CustomEvent;
};

type Eip6963ProviderEntry = Readonly<{
  info: Eip6963Info;
  provider: object;
}>;

export type Eip6963BridgeOptions = Readonly<{
  targetWindow: Eip6963Window;
  getProviders: () => readonly Eip6963ProviderEntry[];
}>;

/**
 * Owns the page-side EIP-6963 binding for Ethereum provider discovery.
 */
export class Eip6963Bridge {
  #targetWindow: Eip6963Window;
  #getProviders: () => readonly Eip6963ProviderEntry[];
  #initialized = false;
  #destroyed = false;

  constructor({ targetWindow, getProviders }: Eip6963BridgeOptions) {
    this.#targetWindow = targetWindow;
    this.#getProviders = getProviders;
  }

  /**
   * Registers the request listener and publishes the current providers once.
   */
  initialize() {
    if (this.#destroyed) {
      throw new Error("Eip6963Bridge cannot initialize after destroy()");
    }
    if (this.#initialized) return;

    this.#targetWindow.addEventListener("eip6963:requestProvider", this.#handleProviderRequest);
    this.#initialized = true;
    this.announceProviders();
  }

  /**
   * Announces every currently available EIP-6963 provider.
   */
  announceProviders() {
    if (this.#destroyed) {
      return;
    }

    for (const { info, provider } of this.#getProviders()) {
      const detail = Object.freeze({
        info: Object.freeze({ ...info }),
        provider,
      });

      this.#targetWindow.dispatchEvent(
        new this.#targetWindow.CustomEvent("eip6963:announceProvider", {
          detail,
        }),
      );
    }
  }

  /**
   * Removes the request listener owned by this bridge.
   */
  destroy() {
    if (this.#destroyed) return;

    this.#destroyed = true;
    if (!this.#initialized) return;

    this.#targetWindow.removeEventListener("eip6963:requestProvider", this.#handleProviderRequest);
    this.#initialized = false;
  }

  #handleProviderRequest = () => {
    this.announceProviders();
  };
}

/**
 * Creates an EIP-6963 bridge for Ethereum provider discovery.
 */
export const createEip6963Bridge = (options: Eip6963BridgeOptions) => new Eip6963Bridge(options);
