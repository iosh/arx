import type { TransportMeta } from "../types/transport.js";

export const cloneTransportMeta = (meta: TransportMeta): TransportMeta => ({
  activeChainByNamespace: { ...meta.activeChainByNamespace },
  supportedChains: [...meta.supportedChains],
});

export const isTransportMeta = (value: unknown): value is TransportMeta => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TransportMeta>;
  if (
    !candidate.activeChainByNamespace ||
    typeof candidate.activeChainByNamespace !== "object" ||
    Object.values(candidate.activeChainByNamespace).some((chain) => typeof chain !== "string")
  ) {
    return false;
  }
  if (!Array.isArray(candidate.supportedChains)) return false;
  return candidate.supportedChains.every((chain) => typeof chain === "string");
};
