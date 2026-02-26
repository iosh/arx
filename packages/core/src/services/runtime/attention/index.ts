import { InMemoryAttentionService } from "./InMemoryAttentionService.js";
import type { AttentionMessenger } from "./topics.js";
import type { AttentionService } from "./types.js";

export { InMemoryAttentionService } from "./InMemoryAttentionService.js";
export * from "./topics.js";
export type {
  AttentionReason,
  AttentionRequest,
  AttentionRequestResult,
  AttentionService,
  AttentionState,
  RequestAttentionParams,
} from "./types.js";

export const createAttentionService = (opts: {
  messenger: AttentionMessenger;
  now?: () => number;
  defaultTtlMs?: number;
  maxQueueSize?: number;
}): AttentionService => {
  return new InMemoryAttentionService(opts);
};
