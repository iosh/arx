import type { TransportMeta } from "../types/transport.js";

export const cloneTransportMeta = (meta: TransportMeta): TransportMeta => ({
  activeChain: meta.activeChain,
  activeNamespace: meta.activeNamespace,
  ...(meta.activeChainByNamespace ? { activeChainByNamespace: { ...meta.activeChainByNamespace } } : {}),
  supportedChains: [...meta.supportedChains],
});

export const isTransportMeta = (value: unknown): value is TransportMeta => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TransportMeta>;
  if (typeof candidate.activeChain !== "string") return false;
  if (typeof candidate.activeNamespace !== "string") return false;
  if (
    candidate.activeChainByNamespace !== undefined &&
    (!candidate.activeChainByNamespace ||
      typeof candidate.activeChainByNamespace !== "object" ||
      Object.values(candidate.activeChainByNamespace).some((chain) => typeof chain !== "string"))
  ) {
    return false;
  }
  if (!Array.isArray(candidate.supportedChains)) return false;
  return candidate.supportedChains.every((chain) => typeof chain === "string");
};
