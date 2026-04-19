import { describe, expect, it } from "vitest";
import { parseUiEnvelope } from "./protocol/envelopes.js";
import {
  UI_EVENT_APPROVAL_DETAIL_CHANGED,
  UI_EVENT_APPROVALS_CHANGED,
  UI_EVENT_ENTRY_CHANGED,
  UI_EVENT_SNAPSHOT_CHANGED,
} from "./protocol/events.js";
import {
  isUiEventName,
  isUiMethodName,
  parseUiEventPayload,
  parseUiMethodParams,
  parseUiMethodResult,
} from "./protocol/index.js";

const SNAPSHOT_FIXTURE = {
  chain: {
    chainRef: "eip155:1",
    chainId: "0x1",
    namespace: "eip155",
    displayName: "Ethereum",
    shortName: "eth",
    icon: null,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  chainCapabilities: {
    nativeBalance: true,
    sendTransaction: true,
  },
  networks: {
    selectedNamespace: "eip155",
    active: "eip155:1",
    known: [
      {
        chainRef: "eip155:1",
        chainId: "0x1",
        namespace: "eip155",
        displayName: "Ethereum",
        shortName: "eth",
        icon: null,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
    ],
    available: [
      {
        chainRef: "eip155:1",
        chainId: "0x1",
        namespace: "eip155",
        displayName: "Ethereum",
        shortName: "eth",
        icon: null,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
    ],
  },
  accounts: {
    totalCount: 0,
    list: [],
    active: null,
  },
  session: {
    isUnlocked: false,
    autoLockDurationMs: 900_000,
    nextAutoLockAt: null,
  },
  attention: {
    queue: [],
    count: 0,
  },
  permissions: {
    origins: {},
  },
  backup: {
    pendingHdKeyringCount: 0,
    nextHdKeyring: null,
  },
  vault: {
    initialized: false,
  },
} as const;

describe("ui protocol registry", () => {
  it("recognizes method/event names", () => {
    expect(isUiMethodName("ui.snapshot.get")).toBe(true);
    expect(isUiMethodName("ui.snapshot.nope")).toBe(false);

    expect(isUiEventName(UI_EVENT_ENTRY_CHANGED)).toBe(true);
    expect(isUiEventName(UI_EVENT_SNAPSHOT_CHANGED)).toBe(true);
    expect(isUiEventName("ui:unknown")).toBe(false);
  });

  it("validates method params (strict)", () => {
    expect(parseUiMethodParams("ui.snapshot.get", undefined)).toBeUndefined();
    expect(() => parseUiMethodParams("ui.snapshot.get", {})).toThrow();

    const params = parseUiMethodParams("ui.session.setAutoLockDuration", { durationMs: 60_000 });
    expect(params.durationMs).toBe(60_000);
    expect(() => parseUiMethodParams("ui.session.setAutoLockDuration", { durationMs: "60_000" })).toThrow();

    expect(parseUiMethodParams("ui.session.lock", undefined)).toBeUndefined();
    expect(parseUiMethodParams("ui.session.lock", {})).toEqual({});
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
  });

  it("validates method results (strict)", () => {
    const okPk = parseUiMethodResult("ui.keyrings.exportPrivateKey", { privateKey: "f".repeat(64) });
    expect(okPk.privateKey.length).toBe(64);
    expect(() => parseUiMethodResult("ui.keyrings.exportPrivateKey", { privateKey: `0x${"f".repeat(64)}` })).toThrow();

    const okOnboardingMnemonic = parseUiMethodResult("ui.onboarding.generateMnemonic", {
      words: Array.from<string>({ length: 12 }).fill("word"),
    });
    expect(okOnboardingMnemonic.words).toHaveLength(12);

    const okApprovalResolve = parseUiMethodResult("ui.approvals.resolve", null);
    expect(okApprovalResolve).toBeNull();
  });

  it("validates event payloads (strict)", () => {
    const payload = parseUiEventPayload(UI_EVENT_SNAPSHOT_CHANGED, SNAPSHOT_FIXTURE);
    expect(payload.chain.chainId).toBe("0x1");

    const entryPayload = parseUiEventPayload(UI_EVENT_ENTRY_CHANGED, {
      environment: "notification",
      reason: "approval_created",
      context: {
        approvalId: "approval-1",
        origin: "https://dapp.example",
        method: "eth_requestAccounts",
        chainRef: "eip155:1",
        namespace: "eip155",
      },
    });
    expect(entryPayload.context.approvalId).toBe("approval-1");

    expect(parseUiEventPayload(UI_EVENT_APPROVALS_CHANGED, { reason: "changed" })).toEqual({ reason: "changed" });
    expect(parseUiEventPayload(UI_EVENT_APPROVAL_DETAIL_CHANGED, { approvalId: "approval-1" })).toEqual({
      approvalId: "approval-1",
    });
  });
});

describe("ui envelope parsing", () => {
  it("parses valid envelopes and rejects unknown method/event", () => {
    expect(
      parseUiEnvelope({
        type: "ui:request",
        id: "1",
        method: "ui.snapshot.get",
      }),
    ).toMatchObject({ type: "ui:request", id: "1", method: "ui.snapshot.get" });

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
        error: { reason: "RpcInvalidRequest", message: "nope" },
      }),
    ).toMatchObject({ type: "ui:error", id: "1" });

    expect(
      parseUiEnvelope({
        type: "ui:event",
        event: UI_EVENT_SNAPSHOT_CHANGED,
        payload: SNAPSHOT_FIXTURE,
      }),
    ).toMatchObject({ type: "ui:event", event: UI_EVENT_SNAPSHOT_CHANGED });

    expect(() =>
      parseUiEnvelope({
        type: "ui:request",
        id: "1",
        method: "ui.snapshot.nope",
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
        error: { reason: "X", message: 123 },
      }),
    ).toThrow();

    expect(() =>
      parseUiEnvelope({
        type: "ui:error",
        id: "1",
        error: { reason: "UnknownReason", message: "nope" },
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
