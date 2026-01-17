import { ArxReasons, arxError } from "@arx/errors";
import { encodeErrorWithAdapters } from "../../rpc/index.js";
import { UI_EVENT_SNAPSHOT_CHANGED } from "../events.js";
import { uiMethods } from "../methods.js";
import { isUiMethodName, parseUiMethodParams, parseUiMethodResult } from "../protocol.js";
import type { UiMethodName } from "../protocol.js";
import type { UiEventEnvelope, UiPortEnvelope, UiRequestEnvelope } from "../messages.js";
import { buildUiSnapshot } from "./snapshot.js";
import { createUiHandlers } from "./handlers.js";
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

const isRequestEnvelope = (value: unknown): value is UiRequestEnvelope => {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown; id?: unknown; method?: unknown };
  return v.type === "ui:request" && typeof v.id === "string" && typeof v.method === "string";
};

const resolveContext = (deps: Pick<UiRuntimeDeps, "controllers">) => {
  const chain = deps.controllers.network.getActiveChain();
  return { namespace: chain.namespace, chainRef: chain.chainRef };
};

export const createUiDispatcher = (deps: UiRuntimeDeps) => {
  const handlers = createUiHandlers(deps) as Record<UiMethodName, (params: any) => Promise<any> | any>;

  const buildSnapshotEvent = (): UiEventEnvelope => {
    const snapshot = buildUiSnapshot({
      controllers: deps.controllers,
      session: deps.session,
      keyring: deps.keyring,
      attention: deps.attention,
    });

    return {
      type: "ui:event",
      event: UI_EVENT_SNAPSHOT_CHANGED,
      payload: snapshot,
      context: resolveContext(deps),
    };
  };

  const dispatch = async (raw: unknown): Promise<UiDispatchOutput | null> => {
    if (!isRequestEnvelope(raw)) return null;
    if (raw.id.length === 0) return null;

    const ctx = resolveContext(deps);

    if (!isUiMethodName(raw.method)) {
      const encoded = encodeErrorWithAdapters(
        arxError({ reason: ArxReasons.RpcInvalidRequest, message: `Unknown UI method: ${raw.method}` }),
        { surface: "ui", namespace: ctx.namespace, chainRef: ctx.chainRef, method: raw.method },
      );
      return {
        reply: { type: "ui:error", id: raw.id, error: encoded as any, context: ctx },
        effects: { broadcastSnapshot: false, persistVaultMeta: false, holdBroadcast: false },
      };
    }

    const method = raw.method as UiMethodName;
    const methodMeta = uiMethods[method];
    const effects: UiDispatchEffects = {
      broadcastSnapshot: methodMeta.effects?.broadcastSnapshot ?? false,
      persistVaultMeta: methodMeta.effects?.persistVaultMeta ?? false,
      holdBroadcast: methodMeta.effects?.holdBroadcast ?? false,
    };

    try {
      const params = parseUiMethodParams(method, raw.params);
      const result = await handlers[method](params as any);
      const parsed = parseUiMethodResult(method, result);
      return {
        reply: { type: "ui:response", id: raw.id, result: parsed, context: ctx },
        effects,
      };
    } catch (error) {
      const encoded = encodeErrorWithAdapters(error, {
        surface: "ui",
        namespace: ctx.namespace,
        chainRef: ctx.chainRef,
        method,
      });
      return {
        reply: { type: "ui:error", id: raw.id, error: encoded as any, context: ctx },
        effects: { broadcastSnapshot: false, persistVaultMeta: false, holdBroadcast: false },
      };
    }
  };

  return { dispatch, buildSnapshotEvent };
};

