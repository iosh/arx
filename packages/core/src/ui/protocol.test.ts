import { describe, expect, it } from "vitest";
import { parseUiEnvelope } from "./protocol/envelopes.js";
import { UI_EVENT_ENTRY_CHANGED, UI_EVENT_READY, UI_EVENT_SESSION_CHANGED } from "./protocol/events.js";
import { isUiEventName, isUiMethodName, parseUiMethodParams } from "./protocol/index.js";

describe("ui protocol registry", () => {
  it("recognizes method/event names", () => {
    expect(isUiMethodName("ui.entry.getLaunchContext")).toBe(true);
    expect(isUiMethodName("ui.onboarding.openTab")).toBe(true);
    expect(isUiMethodName("ui.session.getStatus")).toBe(false);
    expect(isUiMethodName("ui.snapshot.get")).toBe(false);
    expect(isUiMethodName("ui.snapshot.nope")).toBe(false);

    expect(isUiEventName(UI_EVENT_ENTRY_CHANGED)).toBe(true);
    expect(isUiEventName(UI_EVENT_READY)).toBe(true);
    expect(isUiEventName(UI_EVENT_SESSION_CHANGED)).toBe(true);
    expect(isUiEventName("ui:unknown")).toBe(false);
  });

  it("validates method params (strict)", () => {
    expect(parseUiMethodParams("ui.entry.getBootstrap", { environment: "notification" })).toEqual({
      environment: "notification",
    });
    expect(parseUiMethodParams("ui.onboarding.openTab", { reason: "manual_open" })).toEqual({
      reason: "manual_open",
    });
    expect(() => parseUiMethodParams("ui.entry.getBootstrap", { environment: "sidepanel" })).toThrow();
  });
});

describe("ui envelope parsing", () => {
  it("parses valid envelopes and rejects unknown method/event", () => {
    expect(
      parseUiEnvelope({
        type: "ui:request",
        id: "1",
        method: "ui.entry.getLaunchContext",
        params: { environment: "popup" },
      }),
    ).toMatchObject({ type: "ui:request", id: "1", method: "ui.entry.getLaunchContext" });

    expect(
      parseUiEnvelope({
        type: "ui:response",
        id: "1",
        result: { ok: true },
        context: { namespace: "eip155", chainRef: "eip155:1" },
      }),
    ).toMatchObject({ type: "ui:response", id: "1" });

    expect(
      parseUiEnvelope({
        type: "ui:error",
        id: "1",
        error: {
          kind: "ArxError",
          name: "RpcInvalidRequestError",
          code: "global.rpc.invalid_request",
          message: "nope",
        },
      }),
    ).toMatchObject({ type: "ui:error", id: "1" });

    expect(
      parseUiEnvelope({
        type: "ui:event",
        event: UI_EVENT_READY,
        payload: { ready: true },
      }),
    ).toMatchObject({ type: "ui:event", event: UI_EVENT_READY });

    expect(() =>
      parseUiEnvelope({
        type: "ui:request",
        id: "1",
        method: "ui.snapshot.get",
      }),
    ).toThrow();

    expect(() =>
      parseUiEnvelope({
        type: "ui:event",
        event: "ui:unknown",
        payload: {},
      }),
    ).toThrow();
  });

  it("rejects invalid envelope shapes", () => {
    expect(() => parseUiEnvelope(null)).toThrow();

    expect(() =>
      parseUiEnvelope({
        type: "ui:error",
        id: "1",
        error: { kind: "ArxError", name: "X", code: "x", message: 123 },
      }),
    ).toThrow();

    expect(() =>
      parseUiEnvelope({
        type: "ui:error",
        id: "1",
        error: { kind: "ArxError", name: "UnknownReason", code: "x", message: "nope", extra: true },
      }),
    ).toThrow();

    expect(() =>
      parseUiEnvelope({
        type: "ui:response",
        id: 1,
        result: {},
      }),
    ).toThrow();
  });
});
