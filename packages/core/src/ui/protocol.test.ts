import { describe, expect, it } from "vitest";
import { parseUiEnvelope } from "./protocol/envelopes.js";
import { UI_EVENT_ENTRY_CHANGED, UI_EVENT_READY, UI_EVENT_SESSION_CHANGED } from "./protocol/events.js";
import { isUiEventName, isUiMethodName, parseUiMethodParams } from "./protocol/index.js";

describe("ui protocol registry", () => {
  it("recognizes method/event names", () => {
    expect(isUiMethodName("ui.snapshot.get")).toBe(false);
    expect(isUiMethodName("ui.snapshot.nope")).toBe(false);

    expect(isUiEventName(UI_EVENT_ENTRY_CHANGED)).toBe(true);
    expect(isUiEventName(UI_EVENT_READY)).toBe(true);
    expect(isUiEventName(UI_EVENT_SESSION_CHANGED)).toBe(true);
    expect(isUiEventName("ui:unknown")).toBe(false);
  });

  it("validates method params (strict)", () => {
    const params = parseUiMethodParams("ui.session.setAutoLockDuration", { durationMs: 60_000 });
    expect(params.durationMs).toBe(60_000);
    expect(() => parseUiMethodParams("ui.session.setAutoLockDuration", { durationMs: "60_000" })).toThrow();

    expect(parseUiMethodParams("ui.session.lock", undefined)).toEqual({ reason: "manual" });
    expect(parseUiMethodParams("ui.session.lock", {})).toEqual({ reason: "manual" });
    expect(() => parseUiMethodParams("ui.session.lock", { reason: "__bad__" })).toThrow();

    expect(
      parseUiMethodParams("ui.approvals.resolve", {
        approvalId: "approval-1",
        action: "approve",
        decision: {
          accountKeys: ["eip155:0000000000000000000000000000000000000000"],
        },
      }),
    ).toMatchObject({
      approvalId: "approval-1",
      action: "approve",
    });
    expect(() =>
      parseUiMethodParams("ui.approvals.resolve", {
        approvalId: "approval-1",
        action: "approve",
        decision: {
          accountKeys: [
            "eip155:0000000000000000000000000000000000000000",
            "eip155:0000000000000000000000000000000000000000",
          ],
        },
      }),
    ).toThrow();

    expect(parseUiMethodParams("ui.approvals.getDetail", { approvalId: "approval-1" })).toEqual({
      approvalId: "approval-1",
    });
    expect(parseUiMethodParams("ui.transactions.listHistory", { status: "submitted", limit: 10 })).toEqual({
      status: "submitted",
      limit: 10,
    });
    expect(parseUiMethodParams("ui.transactions.getDetail", { transactionId: "tx-1" })).toEqual({
      transactionId: "tx-1",
    });
    expect(parseUiMethodParams("ui.transactions.rerunPrepare", { approvalId: "approval-1" })).toEqual({
      approvalId: "approval-1",
    });
    expect(parseUiMethodParams("ui.entry.getBootstrap", { environment: "notification" })).toEqual({
      environment: "notification",
    });
  });
});

describe("ui envelope parsing", () => {
  it("parses valid envelopes and rejects unknown method/event", () => {
    expect(
      parseUiEnvelope({
        type: "ui:request",
        id: "1",
        method: "ui.session.getStatus",
      }),
    ).toMatchObject({ type: "ui:request", id: "1", method: "ui.session.getStatus" });

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
