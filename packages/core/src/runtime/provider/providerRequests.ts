import { ArxReasons, arxError } from "@arx/errors";
import type { JsonRpcParams, JsonRpcRequest } from "@metamask/utils";
import type { ApprovalTerminalReason } from "../../controllers/approval/types.js";
import type {
  RpcBlockingApprovalReservation,
  RpcProviderRequestCancellationReason,
  RpcProviderRequestHandle,
} from "../../rpc/executionContext.js";

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

export type ProviderRequestCancellationReason = RpcProviderRequestCancellationReason;

type ProviderRequestTerminalState =
  | { status: "fulfilled" }
  | { status: "rejected" }
  | { status: "cancelled"; reason: ProviderRequestCancellationReason };

export type BlockingApprovalReservation = RpcBlockingApprovalReservation;

export type ProviderRequestHandle = RpcProviderRequestHandle;

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

type Awaitable<T> = T | Promise<T>;

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

  if (terminalState.status === "cancelled" && terminalState.reason === "caller_disconnected") {
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
    const abortController = new AbortController();
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
    const getTerminalState = () => terminalState;

    const handle: ProviderRequestHandle = {
      id,
      providerNamespace: currentRecord.providerNamespace,
      signal: abortController.signal,
      attachBlockingApproval: async <T extends object>(
        createApproval: (reservation: BlockingApprovalReservation) => Awaitable<T>,
        reservationInput?: Partial<BlockingApprovalReservation>,
      ): Promise<T & BlockingApprovalReservation> => {
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
          const approval = await createApproval(reservation);
          const currentTerminalState = getTerminalState();
          if (currentTerminalState) {
            await cancelApproval({
              approvalId: reservation.approvalId,
              reason: currentTerminalState.status === "cancelled" ? currentTerminalState.reason : "internal_error",
            });
            throw createTerminalRequestError(currentRecord, currentTerminalState);
          }

          return {
            ...approval,
            approvalId: reservation.approvalId,
            createdAt: reservation.createdAt,
          };
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

        abortController.abort(createTerminalRequestError(currentRecord, { status: "cancelled", reason }));

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
      const rejectionReasons = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason);
      const cancelledCount = results.reduce((count, result) => {
        return result.status === "fulfilled" && result.value ? count + 1 : count;
      }, 0);

      if (rejectionReasons.length === 1) {
        throw rejectionReasons[0];
      }

      if (rejectionReasons.length > 1) {
        throw new AggregateError(rejectionReasons, "Failed to cancel one or more provider requests.");
      }

      return cancelledCount;
    },
  };
};
