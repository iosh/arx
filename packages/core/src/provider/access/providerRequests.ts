import type { JsonRpcParams, JsonRpcRequest } from "@metamask/utils";
import { RpcInternalError } from "../../rpc/errors.js";
import type { RpcProviderRequestCancellationReason, RpcProviderRequestHandle } from "../../rpc/executionContext.js";
import { ProviderDisconnectedError, ProviderRequestCancellationError } from "./errors.js";

export type ProviderRequestScope = {
  transport: "provider";
  origin: string;
  portId: string;
  sessionId: string;
};

export type ProviderRequestRecord = {
  id: string;
  scope: ProviderRequestScope;
  rpcId: JsonRpcRequest<JsonRpcParams>["id"];
  namespace: string;
  method: string;
  createdAt: number;
};

export type ProviderRequestCancellationReason = RpcProviderRequestCancellationReason;

type ProviderRequestTerminalState =
  | { status: "fulfilled" }
  | { status: "rejected" }
  | { status: "cancelled"; reason: ProviderRequestCancellationReason };

export type ProviderRequestHandle = RpcProviderRequestHandle;

export type ProviderRequestBeginInput = Omit<ProviderRequestRecord, "id" | "createdAt">;

export type ProviderRequests = {
  beginRequest(input: ProviderRequestBeginInput): ProviderRequestHandle;
  has(id: string): boolean;
  get(id: string): ProviderRequestRecord | undefined;
  listPending(): ProviderRequestRecord[];
  cancelScope(scope: ProviderRequestScope, reason: ProviderRequestCancellationReason): Promise<number>;
};

const cloneRecord = (record: ProviderRequestRecord): ProviderRequestRecord => ({
  id: record.id,
  scope: { ...record.scope },
  rpcId: record.rpcId,
  namespace: record.namespace,
  method: record.method,
  createdAt: record.createdAt,
});

const toScopeKey = (scope: ProviderRequestScope) => {
  return `${scope.transport}\n${scope.origin}\n${scope.portId}\n${scope.sessionId}`;
};

const createTerminalRequestError = (
  _record: ProviderRequestRecord,
  terminalState: ProviderRequestTerminalState,
): Error => {
  if (terminalState.status === "cancelled" && terminalState.reason === "caller_disconnected") {
    return new ProviderDisconnectedError();
  }

  return new RpcInternalError({
    message: "Provider request is no longer pending.",
  });
};

export const createProviderRequests = (): ProviderRequests => {
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
    const id = crypto.randomUUID();
    let currentRecord: ProviderRequestRecord = {
      id,
      scope: { ...input.scope },
      rpcId: input.rpcId,
      namespace: input.namespace,
      method: input.method,
      createdAt: Date.now(),
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
      namespace: currentRecord.namespace,
      fulfill: () => finalize({ status: "fulfilled" }),
      reject: () => finalize({ status: "rejected" }),
      cancel: async (reason) => {
        const didTransition = finalize({ status: "cancelled", reason });
        if (!didTransition) {
          return false;
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
        throw new ProviderRequestCancellationError(rejectionReasons.length);
      }

      return cancelledCount;
    },
  };
};
