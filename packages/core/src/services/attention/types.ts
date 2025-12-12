export type AttentionReason = "unlock_required";

export type AttentionRequest = {
  reason: AttentionReason;
  origin: string;
  method: string;
  chainRef: string | null;
  namespace: string | null;
  requestedAt: number;
  expiresAt: number;
};

export type AttentionState = {
  queue: AttentionRequest[];
  count: number;
};

export type RequestAttentionParams = {
  reason: AttentionReason;
  origin: string;
  method: string;
  chainRef?: string | null;
  namespace?: string | null;
  ttlMs?: number;
};

export type AttentionRequestResult = {
  enqueued: boolean;
  request: AttentionRequest | null;
  state: AttentionState;
};

export type AttentionServiceMessengerTopics = {
  "attention:requested": AttentionRequest;
  "attention:stateChanged": AttentionState;
};

export type AttentionService = {
  requestAttention(params: RequestAttentionParams): AttentionRequestResult;
  getSnapshot(): AttentionState;
  clear(): AttentionState;
  clearExpired(): AttentionState;
};
