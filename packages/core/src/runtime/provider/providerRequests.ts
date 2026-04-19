import { ArxReasons, arxError } from "@arx/errors";
import type { JsonRpcParams, JsonRpcRequest } from "@metamask/utils";
import type { ApprovalHandle, ApprovalKind, ApprovalTerminalReason } from "../../controllers/approval/types.js";

export type ProviderRuntimeRequestScope = {
  transport: "provider";
  origin: string;
  portId: string;
  sessionId: string;
};

export type ProviderRequestRecord = {
  id: string;
  scope: ProviderRuntimeRequestScope;
  rpcId: JsonRpcRequest<JsonRpcParams>["id"];
  providerNamespace: string;
  method: string;
  createdAt: number;
  blockingApprovalId?: string;
};

export type ProviderRequestCancellationReason = Extract<ApprovalTerminalReason, "session_lost">;

type ProviderRequestTerminalState =
  | { status: "fulfilled" }
  | { status: "rejected" }
  | { status: "cancelled"; reason: ProviderRequestCancellationReason };

export type BlockingApprovalReservation = {
  approvalId: string;
  createdAt: number;
};

export type ProviderRequestHandle = {
  id: string;
  providerNamespace: string;
  attachBlockingApproval<K extends ApprovalKind>(
    createApproval: (reservation: BlockingApprovalReservation) => ApprovalHandle<K>,
    reservation?: Partial<BlockingApprovalReservation>,
  ): ApprovalHandle<K>;
  fulfill(): boolean;
  reject(): boolean;
  cancel(reason: ProviderRequestCancellationReason): Promise<boolean>;
  getTerminalError(): Error | null;
};

export type ProviderRequestBeginInput = Omit<ProviderRequestRecord, "id" | "createdAt">;

export type ProviderRequests = {
  beginRequest(input: ProviderRequestBeginInput): ProviderRequestHandle;
  has(id: string): boolean;
  get(id: string): ProviderRequestRecord | undefined;
  listPending(): ProviderRequestRecord[];
  cancelScope(scope: ProviderRuntimeRequestScope, reason: ProviderRequestCancellationReason): Promise<number>;
};

type CreateProviderRequestsDeps = {
  generateId: () => string;
  now: () => number;
  cancelApproval: (input: { approvalId: string; reason: ApprovalTerminalReason }) => Promise<void>;
};

const cloneRecord = (record: ProviderRequestRecord): ProviderRequestRecord => ({
  id: record.id,
  scope: { ...record.scope },
  rpcId: record.rpcId,
  providerNamespace: record.providerNamespace,
  method: record.method,
  createdAt: record.createdAt,
  ...(record.blockingApprovalId ? { blockingApprovalId: record.blockingApprovalId } : {}),
});

const toScopeKey = (scope: ProviderRuntimeRequestScope) => {
  return `${scope.transport}\n${scope.origin}\n${scope.portId}\n${scope.sessionId}`;
};

const reserveBlockingApproval = (
  input: Partial<BlockingApprovalReservation> | undefined,
  deps: Pick<CreateProviderRequestsDeps, "generateId" | "now">,
): BlockingApprovalReservation => ({
  approvalId: input?.approvalId ?? deps.generateId(),
  createdAt: input?.createdAt ?? deps.now(),
});

const createTerminalRequestError = (
  record: ProviderRequestRecord,
  terminalState: ProviderRequestTerminalState,
): Error => {
  const data = {
    id: record.id,
    method: record.method,
    origin: record.scope.origin,
    providerNamespace: record.providerNamespace,
    ...(terminalState.status === "cancelled" ? { terminalReason: terminalState.reason } : {}),
  };

  if (terminalState.status === "cancelled" && terminalState.reason === "session_lost") {
    return arxError({
      reason: ArxReasons.TransportDisconnected,
      message: "Transport disconnected.",
      data,
    });
  }

  return arxError({
    reason: ArxReasons.RpcInternal,
    message: "Provider request is no longer pending.",
    data,
  });
};

export const createProviderRequests = ({
  generateId,
  now,
  cancelApproval,
}: CreateProviderRequestsDeps): ProviderRequests => {
  const records = new Map<string, ProviderRequestRecord>();
  const scopeIndex = new Map<string, Set<string>>();
  const handles = new Map<string, ProviderRequestHandle>();

  const removeFromScopeIndex = (record: ProviderRequestRecord) => {
    const scopeKey = toScopeKey(record.scope);
    const ids = scopeIndex.get(scopeKey);
    if (!ids) {
      return;
    }

    ids.delete(record.id);
    if (ids.size === 0) {
      scopeIndex.delete(scopeKey);
    }
  };

  const beginRequest = (input: ProviderRequestBeginInput): ProviderRequestHandle => {
    const id = generateId();
    let currentRecord: ProviderRequestRecord = {
      id,
      scope: { ...input.scope },
      rpcId: input.rpcId,
      providerNamespace: input.providerNamespace,
      method: input.method,
      createdAt: now(),
    };
    let terminalState: ProviderRequestTerminalState | null = null;

    records.set(id, currentRecord);

    const scopeKey = toScopeKey(currentRecord.scope);
    const scopedIds = scopeIndex.get(scopeKey);
    if (scopedIds) {
      scopedIds.add(id);
    } else {
      scopeIndex.set(scopeKey, new Set([id]));
    }

    const finalize = (nextState: ProviderRequestTerminalState): boolean => {
      if (terminalState) {
        return false;
      }

      const liveRecord = records.get(id);
      if (!liveRecord) {
        return false;
      }

      currentRecord = liveRecord;
      terminalState = nextState;
      records.delete(id);
      handles.delete(id);
      removeFromScopeIndex(liveRecord);
      return true;
    };

    const handle: ProviderRequestHandle = {
      id,
      providerNamespace: currentRecord.providerNamespace,
      attachBlockingApproval: (createApproval, reservationInput) => {
        if (terminalState) {
          throw createTerminalRequestError(currentRecord, terminalState);
        }

        const liveRecord = records.get(id);
        if (!liveRecord) {
          throw createTerminalRequestError(
            currentRecord,
            terminalState ?? {
              status: "rejected",
            },
          );
        }
        if (liveRecord.blockingApprovalId) {
          throw new Error(`Provider request "${id}" already has a blocking approval.`);
        }

        const reservation = reserveBlockingApproval(reservationInput, { generateId, now });
        currentRecord = {
          ...liveRecord,
          blockingApprovalId: reservation.approvalId,
        };
        records.set(id, currentRecord);

        try {
          const approvalHandle = createApproval(reservation);
          if (approvalHandle.approvalId !== reservation.approvalId) {
            throw new Error(`Provider request "${id}" created a mismatched blocking approval handle.`);
          }
          return approvalHandle;
        } catch (error) {
          const currentLiveRecord = records.get(id);
          if (currentLiveRecord?.blockingApprovalId === reservation.approvalId) {
            const rollbackRecord = cloneRecord(currentLiveRecord);
            delete rollbackRecord.blockingApprovalId;
            currentRecord = rollbackRecord;
            records.set(id, rollbackRecord);
          }
          throw error;
        }
      },
      fulfill: () => finalize({ status: "fulfilled" }),
      reject: () => finalize({ status: "rejected" }),
      cancel: async (reason) => {
        const didTransition = finalize({ status: "cancelled", reason });
        if (!didTransition) {
          return false;
        }

        if (currentRecord.blockingApprovalId) {
          await cancelApproval({
            approvalId: currentRecord.blockingApprovalId,
            reason,
          });
        }

        return true;
      },
      getTerminalError: () => (terminalState ? createTerminalRequestError(currentRecord, terminalState) : null),
    };

    handles.set(id, handle);
    return handle;
  };

  return {
    beginRequest,
    has: (id) => records.has(id),
    get: (id) => {
      const record = records.get(id);
      return record ? cloneRecord(record) : undefined;
    },
    listPending: () => {
      return [...records.values()]
        .map((record) => cloneRecord(record))
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    },
    cancelScope: async (scope, reason) => {
      const ids = [...(scopeIndex.get(toScopeKey(scope)) ?? [])];
      if (ids.length === 0) {
        return 0;
      }

      const results = await Promise.allSettled(ids.map((id) => handles.get(id)?.cancel(reason) ?? false));
      const firstRejected = results.find((result) => result.status === "rejected");
      const cancelledCount = results.reduce((count, result) => {
        return result.status === "fulfilled" && result.value ? count + 1 : count;
      }, 0);

      if (firstRejected?.status === "rejected") {
        throw firstRejected.reason;
      }

      return cancelledCount;
    },
  };
};
