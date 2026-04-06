import type { HandshakeAckPayload, ProviderEventPayload } from "../protocol/envelope.js";

export type TransportCodecResult<TPatch> =
  | {
      kind: "patches";
      patches: readonly TPatch[];
    }
  | {
      kind: "disconnect";
      error?: unknown;
    }
  | {
      kind: "ignore";
    };

export type TransportCodec<TSnapshot, TPatch> = Readonly<{
  cloneSnapshot(snapshot: TSnapshot): TSnapshot;
  clonePatch(patch: TPatch): TPatch;
  applyPatch(snapshot: TSnapshot, patch: TPatch): TSnapshot;
  parseHandshakeState(state: HandshakeAckPayload["state"]): TSnapshot | null;
  parseEvent(payload: ProviderEventPayload): TransportCodecResult<TPatch>;
}>;
