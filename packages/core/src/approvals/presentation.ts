import type { ChainRef } from "../chains/ids.js";
import type { ApprovalQueueItem, ApprovalRecord } from "../controllers/approval/types.js";
import type { ApprovalSummary } from "./summary.js";
import type { ApprovalFlowPresenterDeps, ApprovalSummaryBaseOptions } from "./types.js";

type UiWarning = {
  code: string;
  message: string;
  level?: "info" | "warning" | "error";
  details?: Record<string, unknown>;
};

type UiIssue = {
  code: string;
  message: string;
  severity?: "low" | "medium" | "high";
  details?: Record<string, unknown>;
};

export const createApprovalSummaryBase = (
  record: Pick<ApprovalRecord, "id" | "kind" | "origin" | "namespace" | "chainRef" | "createdAt">,
  deps: ApprovalFlowPresenterDeps,
  options?: ApprovalSummaryBaseOptions,
): {
  id: string;
  origin: string;
  namespace: string;
  chainRef: ChainRef;
  createdAt: number;
} => {
  const reviewChain = deps.chainViews.getApprovalReviewChainView({
    record: record as Pick<ApprovalRecord, "id" | "kind" | "namespace" | "chainRef">,
    ...(options?.request ? { request: options.request } : {}),
  });

  return {
    id: record.id,
    origin: record.origin,
    namespace: reviewChain.namespace,
    chainRef: reviewChain.chainRef,
    createdAt: record.createdAt,
  };
};

export const toUnsupportedApprovalSummary = (
  record: Pick<
    ApprovalRecord | ApprovalQueueItem,
    "id" | "kind" | "origin" | "namespace" | "chainRef" | "createdAt"
  > & {
    request?: unknown;
  },
): ApprovalSummary => ({
  id: record.id,
  origin: record.origin,
  namespace: record.namespace,
  chainRef: record.chainRef,
  createdAt: record.createdAt,
  type: "unsupported",
  payload: {
    rawType: record.kind,
    ...(record.request !== undefined ? { rawPayload: record.request } : {}),
  },
});

const toDetails = (entry: { details?: unknown; data?: unknown }): Record<string, unknown> | undefined => {
  if (entry.details && typeof entry.details === "object") return entry.details as Record<string, unknown>;
  if (entry.data && typeof entry.data === "object") return entry.data as Record<string, unknown>;
  return undefined;
};

export const toUiWarning = (value: unknown): UiWarning => {
  if (value && typeof value === "object") {
    const entry = value as {
      code?: unknown;
      message?: unknown;
      severity?: unknown;
      details?: unknown;
      data?: unknown;
    };

    const level =
      entry.severity === "low"
        ? "info"
        : entry.severity === "medium"
          ? "warning"
          : entry.severity === "high"
            ? "error"
            : undefined;

    const out: UiWarning = {
      code: typeof entry.code === "string" ? entry.code : "UNKNOWN_WARNING",
      message: typeof entry.message === "string" ? entry.message : "Unknown warning",
    };

    if (level) out.level = level;
    const details = toDetails(entry);
    if (details) out.details = details;
    return out;
  }

  return { code: "UNKNOWN_WARNING", message: String(value ?? "Unknown warning") };
};

export const toUiIssue = (value: unknown): UiIssue => {
  if (value && typeof value === "object") {
    const entry = value as { code?: unknown; message?: unknown; severity?: unknown; details?: unknown; data?: unknown };
    const severity =
      entry.severity === "low" || entry.severity === "medium" || entry.severity === "high"
        ? (entry.severity as UiIssue["severity"])
        : undefined;

    const out: UiIssue = {
      code: typeof entry.code === "string" ? entry.code : "UNKNOWN_ISSUE",
      message: typeof entry.message === "string" ? entry.message : "Unknown issue",
    };

    if (severity) out.severity = severity;
    const details = toDetails(entry);
    if (details) out.details = details;
    return out;
  }

  return { code: "UNKNOWN_ISSUE", message: String(value ?? "Unknown issue") };
};
