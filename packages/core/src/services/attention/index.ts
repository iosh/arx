import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import { InMemoryAttentionService } from "./InMemoryAttentionService.js";
import type { AttentionService, AttentionServiceMessengerTopics } from "./types.js";

export { InMemoryAttentionService } from "./InMemoryAttentionService.js";
export type {
  AttentionReason,
  AttentionRequest,
  AttentionRequestResult,
  AttentionService,
  AttentionServiceMessengerTopics,
  AttentionState,
  RequestAttentionParams,
} from "./types.js";

export const createAttentionService = (opts: {
  messenger: ControllerMessenger<AttentionServiceMessengerTopics>;
  now?: () => number;
  defaultTtlMs?: number;
  maxQueueSize?: number;
}): AttentionService => {
  return new InMemoryAttentionService(opts);
};
