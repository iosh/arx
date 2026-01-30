import { EventEmitter } from "eventemitter3";
import { type ApprovalRecord, ApprovalRecordSchema } from "../../db/records.js";
import type { ApprovalsPort } from "./port.js";
import type { ApprovalsService, CreateApprovalParams, FinalizeApprovalParams } from "./types.js";

type ChangedEvent = "changed";

export type CreateApprovalsServiceOptions = {
  port: ApprovalsPort;
  now?: () => number;
};

export const createApprovalsService = ({ port, now = Date.now }: CreateApprovalsServiceOptions): ApprovalsService => {
  const emitter = new EventEmitter<ChangedEvent>();

  const emitChanged = () => {
    emitter.emit("changed");
  };

  const get = async (id: ApprovalRecord["id"]) => {
    const record = await port.get(id);
    return record ? ApprovalRecordSchema.parse(record) : null;
  };

  const listPending = async () => {
    const records = await port.listPending();
    return records
      .map((r) => ApprovalRecordSchema.parse(r))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  };

  const create = async (params: CreateApprovalParams) => {
    const record: ApprovalRecord = ApprovalRecordSchema.parse({
      id: params.id ?? crypto.randomUUID(),
      type: params.type,
      status: "pending",
      origin: params.origin,
      ...(params.namespace !== undefined ? { namespace: params.namespace } : {}),
      ...(params.chainRef !== undefined ? { chainRef: params.chainRef } : {}),
      payload: params.payload,
      requestContext: params.requestContext,
      expiresAt: params.expiresAt,
      createdAt: params.createdAt ?? now(),
      // finalizedAt/finalStatusReason/result must be omitted for pending
    });

    await port.upsert(record);
    emitChanged();
    return record;
  };

  const finalize = async (params: FinalizeApprovalParams) => {
    const existing = await port.get(params.id);
    if (!existing) return null;

    const current = ApprovalRecordSchema.parse(existing);

    // Idempotency: if it's already finalized, return as-is.
    if (current.status !== "pending") {
      return current;
    }

    const next: ApprovalRecord = ApprovalRecordSchema.parse({
      ...current,
      status: params.status,
      ...(params.result !== undefined ? { result: params.result } : {}),
      finalizedAt: now(),
      finalStatusReason: params.finalStatusReason,
    });

    await port.upsert(next);
    emitChanged();
    return next;
  };

  const expireAllPending = async (params: { finalStatusReason: FinalizeApprovalParams["finalStatusReason"] }) => {
    const pending = await port.listPending();
    if (pending.length === 0) return 0;

    let updated = 0;

    for (const raw of pending) {
      // Re-read to avoid clobbering approvals that finalized after listPending().
      const existing = await port.get(raw.id);
      if (!existing) continue;

      const current = ApprovalRecordSchema.parse(existing);
      if (current.status !== "pending") continue;

      const expired: ApprovalRecord = ApprovalRecordSchema.parse({
        ...current,
        status: "expired",
        finalizedAt: now(),
        finalStatusReason: params.finalStatusReason,
      });

      await port.upsert(expired);
      updated += 1;
    }

    if (updated > 0) {
      emitChanged();
    }

    return updated;
  };
  return {
    on(event, handler) {
      if (event !== "changed") return;
      emitter.on("changed", handler);
    },
    off(event, handler) {
      if (event !== "changed") return;
      emitter.off("changed", handler);
    },

    get,
    listPending,
    create,
    finalize,
    expireAllPending,
  };
};
