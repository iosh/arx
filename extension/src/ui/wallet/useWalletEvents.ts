import type { WalletApiEvent } from "@arx/core/wallet";
import type { WalletClient } from "@arx/wallet-api/client";
import { useEffect, useEffectEvent } from "react";

export function useWalletEvents<T extends WalletApiEvent["type"]>(
  wallet: WalletClient,
  types: T | readonly T[],
  onEvent: (event: Extract<WalletApiEvent, { type: T }>) => void,
) {
  const handleEvent = useEffectEvent((event: WalletApiEvent) => {
    const selectedTypes: readonly WalletApiEvent["type"][] = typeof types === "string" ? [types] : types;
    if (selectedTypes.includes(event.type)) {
      onEvent(event as Extract<WalletApiEvent, { type: T }>);
    }
  });

  useEffect(() => wallet.subscribe(handleEvent), [wallet]);
}
