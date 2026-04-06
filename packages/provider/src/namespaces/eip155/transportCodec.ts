import { PROVIDER_EVENTS, type ProviderEventName } from "../../protocol/events.js";
import type { TransportCodec, TransportCodecResult } from "../../transport/codec.js";
import { cloneTransportMeta, isTransportMeta } from "../../transport/transportMeta.js";
import type { TransportMeta } from "../../types/transport.js";
import { providerErrors } from "./errors.js";
import {
  applyProviderPatch,
  cloneProviderPatch,
  cloneProviderSnapshot,
  type ProviderPatch,
  type ProviderSnapshot,
} from "./state.js";

type Eip155HandshakeState = {
  chainId: string;
  chainRef: string;
  accounts: string[];
  isUnlocked: boolean;
  meta: TransportMeta;
};

type ChainUpdate = {
  chainId: string;
  chainRef?: string | null;
  isUnlocked?: boolean;
  meta?: TransportMeta | null;
};

const ignoreResult = <TPatch>(): TransportCodecResult<TPatch> => ({ kind: "ignore" });

const coerceAccounts = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
};

const isEip155HandshakeState = (value: unknown): value is Eip155HandshakeState => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Eip155HandshakeState>;
  if (typeof candidate.chainId !== "string") return false;
  if (typeof candidate.chainRef !== "string") return false;
  if (typeof candidate.isUnlocked !== "boolean") return false;
  if (!Array.isArray(candidate.accounts) || !candidate.accounts.every((item) => typeof item === "string")) return false;
  if (!isTransportMeta(candidate.meta)) return false;
  return true;
};

const isChainUpdate = (value: unknown): value is ChainUpdate => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChainUpdate>;
  if (typeof candidate.chainId !== "string") return false;
  if (candidate.chainRef !== undefined && candidate.chainRef !== null && typeof candidate.chainRef !== "string")
    return false;
  if (candidate.isUnlocked !== undefined && typeof candidate.isUnlocked !== "boolean") return false;
  if (candidate.meta !== undefined && candidate.meta !== null && !isTransportMeta(candidate.meta)) return false;
  return true;
};

const patchResult = (patches: readonly ProviderPatch[]): TransportCodecResult<ProviderPatch> => ({
  kind: "patches",
  patches,
});

export const eip155TransportCodec: TransportCodec<ProviderSnapshot, ProviderPatch> = {
  cloneSnapshot: cloneProviderSnapshot,
  clonePatch: cloneProviderPatch,
  applyPatch: applyProviderPatch,

  parseHandshakeState(state) {
    if (!isEip155HandshakeState(state)) {
      return null;
    }

    return {
      connected: true,
      chainId: state.chainId,
      chainRef: state.chainRef,
      accounts: [...state.accounts],
      isUnlocked: state.isUnlocked,
      meta: cloneTransportMeta(state.meta),
    };
  },

  parseEvent(payload) {
    const eventName = payload.event as ProviderEventName;
    const params = payload.params ?? [];

    switch (eventName) {
      case PROVIDER_EVENTS.accountsChanged: {
        const accounts = coerceAccounts(params[0]);
        return patchResult([{ type: "accounts", accounts }]);
      }

      case PROVIDER_EVENTS.chainChanged: {
        const update = params[0];
        if (!isChainUpdate(update)) return ignoreResult();
        return patchResult([
          {
            type: "chain",
            chainId: update.chainId,
            ...(update.chainRef === undefined ? {} : { chainRef: update.chainRef ?? null }),
            ...(update.isUnlocked === undefined ? {} : { isUnlocked: update.isUnlocked }),
            ...(update.meta === undefined ? {} : { meta: update.meta ?? null }),
          },
        ]);
      }

      case PROVIDER_EVENTS.metaChanged: {
        const meta = params[0];
        if (meta !== null && !isTransportMeta(meta)) return ignoreResult();
        return patchResult([{ type: "meta", meta: (meta as TransportMeta | null | undefined) ?? null }]);
      }

      case PROVIDER_EVENTS.sessionLocked: {
        return patchResult([
          { type: "accounts", accounts: [] },
          { type: "unlock", isUnlocked: false },
        ]);
      }

      case PROVIDER_EVENTS.sessionUnlocked: {
        return patchResult([{ type: "unlock", isUnlocked: true }]);
      }

      case PROVIDER_EVENTS.disconnect:
        return {
          kind: "disconnect",
          error:
            params[0] && typeof params[0] === "object" && "code" in (params[0] as Record<string, unknown>)
              ? (params[0] as { code: number; message: string; data?: unknown })
              : providerErrors.disconnected(),
        };

      default:
        return ignoreResult();
    }
  },
};
