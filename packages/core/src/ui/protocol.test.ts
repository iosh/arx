import { describe, expect, it } from "vitest";
import { UI_EVENT_SNAPSHOT_CHANGED } from "./events.js";
import {
  isUiEventName,
  isUiMethodName,
  parseUiEventPayload,
  parseUiMethodParams,
  parseUiMethodResult,
} from "./protocol.js";

const SNAPSHOT_FIXTURE = {
  chain: {
    chainRef: "eip155:1",
    chainId: "0x1",
    namespace: "eip155",
    displayName: "Ethereum",
    shortName: "eth",
    icon: null,
  },
  networks: {
    active: "eip155:1",
    known: [
      {
        chainRef: "eip155:1",
        chainId: "0x1",
        namespace: "eip155",
        displayName: "Ethereum",
        shortName: "eth",
        icon: null,
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
  approvals: [],
  attention: {
    queue: [],
    count: 0,
  },
  vault: {
    initialized: false,
  },
  warnings: {
    hdKeyringsNeedingBackup: [],
  },
} as const;

describe("ui protocol registry", () => {
  it("recognizes method/event names", () => {
    expect(isUiMethodName("ui.snapshot.get")).toBe(true);
    expect(isUiMethodName("ui.snapshot.nope")).toBe(false);

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
  });

  it("validates method results (strict)", () => {
    const okPk = parseUiMethodResult("ui.keyrings.exportPrivateKey", { privateKey: "f".repeat(64) });
    expect(okPk.privateKey.length).toBe(64);
    expect(() => parseUiMethodResult("ui.keyrings.exportPrivateKey", { privateKey: "0x" + "f".repeat(64) })).toThrow();

    const okVaultInit = parseUiMethodResult("ui.vault.init", {
      ciphertext: {
        version: 1,
        algorithm: "pbkdf2-sha256",
        salt: "salt",
        iterations: 10,
        iv: "iv",
        cipher: "cipher",
        createdAt: 1,
      },
    });
    expect(okVaultInit.ciphertext.algorithm).toBe("pbkdf2-sha256");
  });

  it("validates event payloads (strict)", () => {
    const payload = parseUiEventPayload(UI_EVENT_SNAPSHOT_CHANGED, SNAPSHOT_FIXTURE);
    expect(payload.chain.chainId).toBe("0x1");
  });
});
