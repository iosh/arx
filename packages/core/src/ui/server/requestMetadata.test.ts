import { describe, expect, it } from "vitest";
import { getUiRequestBroadcastPolicy, getUiRequestExecutionPlan, parseUiRequestMetadata } from "./requestMetadata.js";

describe("parseUiRequestMetadata", () => {
  it("marks snapshot.get as a query plan without side effects", () => {
    const metadata = parseUiRequestMetadata({
      type: "ui:request",
      id: "req-1",
      method: "ui.snapshot.get",
    });

    expect(metadata).toMatchObject({
      method: "ui.snapshot.get",
      plan: {
        kind: "query",
        broadcastSnapshot: false,
        persistVaultMeta: false,
        holdBroadcast: false,
      },
    });
  });

  it("marks unlock as a command plan with atomic snapshot effects", () => {
    const metadata = parseUiRequestMetadata({
      type: "ui:request",
      id: "req-2",
      method: "ui.session.unlock",
      params: { password: "secret" },
    });

    expect(metadata).toMatchObject({
      method: "ui.session.unlock",
      plan: {
        kind: "command",
        broadcastSnapshot: true,
        persistVaultMeta: true,
        holdBroadcast: true,
      },
    });
  });

  it("keeps command/query intent available through getUiRequestExecutionPlan", () => {
    expect(
      getUiRequestExecutionPlan({
        type: "ui:request",
        id: "req-3",
        method: "ui.approvals.openPopup",
      }),
    ).toEqual({
      kind: "command",
      broadcastSnapshot: false,
      persistVaultMeta: false,
      holdBroadcast: false,
    });
  });

  it("only fences requests that need response-before-snapshot ordering", () => {
    expect(
      getUiRequestBroadcastPolicy({
        type: "ui:request",
        id: "req-4",
        method: "ui.snapshot.get",
      }),
    ).toEqual({
      holdBroadcast: false,
      fenceSnapshotBroadcast: false,
    });

    expect(
      getUiRequestBroadcastPolicy({
        type: "ui:request",
        id: "req-5",
        method: "ui.keyrings.exportMnemonic",
        params: { keyringId: crypto.randomUUID(), password: "secret" },
      }),
    ).toEqual({
      holdBroadcast: false,
      fenceSnapshotBroadcast: false,
    });

    expect(
      getUiRequestBroadcastPolicy({
        type: "ui:request",
        id: "req-6",
        method: "ui.session.lock",
      }),
    ).toEqual({
      holdBroadcast: false,
      fenceSnapshotBroadcast: true,
    });

    expect(
      getUiRequestBroadcastPolicy({
        type: "ui:request",
        id: "req-7",
        method: "ui.session.unlock",
        params: { password: "secret" },
      }),
    ).toEqual({
      holdBroadcast: true,
      fenceSnapshotBroadcast: true,
    });
  });
});
