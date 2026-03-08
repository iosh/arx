import { ArxReasons, arxError } from "@arx/errors";
import { createApprovalFlowRegistry } from "../../approvals/index.js";
import type { UiError, UiEventEnvelope, UiPortEnvelope } from "../protocol/envelopes.js";
import { UI_EVENT_SNAPSHOT_CHANGED } from "../protocol/events.js";
import type { UiMethodName } from "../protocol/index.js";
import { isUiMethodName, parseUiMethodParams, parseUiMethodResult } from "../protocol/index.js";
import { uiMethods } from "../protocol/methods.js";
import { createUiHandlers } from "./handlers/index.js";
import { buildUiSnapshot } from "./snapshot.js";
import type { UiRuntimeDeps } from "./types.js";

export type UiDispatchEffects = {
  broadcastSnapshot: boolean;
  persistVaultMeta: boolean;
  holdBroadcast: boolean;
};

export type UiDispatchOutput = {
  reply: UiPortEnvelope;
  effects: UiDispatchEffects;
};

const isRequestEnvelope = (value: unknown): value is UiDispatchRequest => {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown; id?: unknown; method?: unknown };
  return v.type === "ui:request" && typeof v.id === "string" && typeof v.method === "string";
};

type UiDispatchRequest = {
  id: string;
  method: string;
  params?: unknown;
};

type UiRequestMeta = {
  request: UiDispatchRequest;
  method: UiMethodName | null;
  effects: UiDispatchEffects;
};

const EMPTY_EFFECTS: UiDispatchEffects = {
  broadcastSnapshot: false,
  persistVaultMeta: false,
  holdBroadcast: false,
};

const getRequestMeta = (raw: unknown): UiRequestMeta | null => {
  if (!isRequestEnvelope(raw)) return null;
  if (raw.id.length === 0) return null;

  if (!isUiMethodName(raw.method)) {
    return {
      request: raw,
      method: null,
      effects: EMPTY_EFFECTS,
    };
  }

  const method = raw.method as UiMethodName;
  const meta = uiMethods[method];
  return {
    request: raw,
    method,
    effects: {
      broadcastSnapshot: meta.effects?.broadcastSnapshot ?? false,
      persistVaultMeta: meta.effects?.persistVaultMeta ?? false,
      holdBroadcast: meta.effects?.holdBroadcast ?? false,
    },
  };
};

const getUiContext = (deps: Pick<UiRuntimeDeps, "chainViews">) => {
  const chain = deps.chainViews.getActiveChainView();
  return { namespace: chain.namespace, chainRef: chain.chainRef };
};

export const createUiDispatcher = (deps: UiRuntimeDeps) => {
  const handlers = createUiHandlers(deps);
  const approvalFlowRegistry = createApprovalFlowRegistry();

  const buildSnapshotEvent = (): UiEventEnvelope => {
    const snapshot = buildUiSnapshot({
      controllers: deps.controllers,
      chainViews: deps.chainViews,
      session: deps.session,
      keyring: deps.keyring,
      attention: deps.attention,
      approvalFlowRegistry,
    });

    return {
      type: "ui:event",
      event: UI_EVENT_SNAPSHOT_CHANGED,
      payload: snapshot,
      context: getUiContext(deps),
    };
  };

  const getRequestEffects = (raw: unknown): UiDispatchEffects | null => {
    const requestMeta = getRequestMeta(raw);
    return requestMeta?.method ? requestMeta.effects : null;
  };

  const dispatch = async (raw: unknown): Promise<UiDispatchOutput | null> => {
    const requestMeta = getRequestMeta(raw);
    if (!requestMeta) return null;

    const ctx = getUiContext(deps);
    const { request, method, effects } = requestMeta;

    if (!method) {
      const encoded = deps.rpcRegistry.encodeErrorWithAdapters(
        arxError({ reason: ArxReasons.RpcInvalidRequest, message: `Unknown UI method: ${request.method}` }),
        { surface: "ui", namespace: ctx.namespace, chainRef: ctx.chainRef, method: request.method },
      );
      return {
        reply: { type: "ui:error", id: request.id, error: encoded as unknown as UiError, context: ctx },
        effects: EMPTY_EFFECTS,
      };
    }

    try {
      const params = parseUiMethodParams(method, request.params);

      const result = await (handlers[method] as (params: unknown) => unknown)(params);
      const parsed = parseUiMethodResult(method, result);
      return {
        reply: { type: "ui:response", id: request.id, result: parsed, context: ctx },
        effects,
      };
    } catch (error) {
      const encoded = deps.rpcRegistry.encodeErrorWithAdapters(error, {
        surface: "ui",
        namespace: ctx.namespace,
        chainRef: ctx.chainRef,
        method,
      });
      return {
        reply: { type: "ui:error", id: request.id, error: encoded as unknown as UiError, context: ctx },
        effects: EMPTY_EFFECTS,
      };
    }
  };

  return { dispatch, buildSnapshotEvent, getRequestEffects };
};
