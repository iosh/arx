import type { Eip155Provider } from "./provider.js";

const EIP6963_ANNOUNCE_EVENT = "eip6963:announceProvider";
const EIP6963_REQUEST_EVENT = "eip6963:requestProvider";

export type Eip6963ProviderInfo = Readonly<{
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}>;

export type Eip6963ProviderDetail = Readonly<{
  info: Eip6963ProviderInfo;
  provider: Eip155Provider;
}>;

export type Eip155ProviderWindow = EventTarget & {
  Event: typeof Event;
  CustomEvent: typeof CustomEvent;
  ethereum?: unknown;
};

export type AnnounceEip6963ProviderInput = Readonly<{
  targetWindow: Eip155ProviderWindow;
  provider: Eip155Provider;
  info: Eip6963ProviderInfo;
}>;

export const announceEip6963Provider = ({ targetWindow, provider, info }: AnnounceEip6963ProviderInput): void => {
  const detail: Eip6963ProviderDetail = Object.freeze({
    info: Object.freeze({ ...info }),
    provider,
  });
  const announce = () => {
    targetWindow.dispatchEvent(new targetWindow.CustomEvent(EIP6963_ANNOUNCE_EVENT, { detail }));
  };

  announce();
  targetWindow.addEventListener(EIP6963_REQUEST_EVENT, announce);
};

export type SetEthereumProviderInput = Readonly<{
  targetWindow: Eip155ProviderWindow;
  provider: Eip155Provider;
}>;

export const setEthereumProviderIfAbsent = ({ targetWindow, provider }: SetEthereumProviderInput): boolean => {
  try {
    if (targetWindow.ethereum !== undefined) {
      return false;
    }

    targetWindow.ethereum = provider;
    if (targetWindow.ethereum !== provider) {
      return false;
    }
  } catch {
    return false;
  }

  targetWindow.dispatchEvent(new targetWindow.Event("ethereum#initialized"));
  return true;
};
