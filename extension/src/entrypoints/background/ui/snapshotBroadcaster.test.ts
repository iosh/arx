import { UI_EVENT_SNAPSHOT_CHANGED, type UiEventEnvelope } from "@arx/core/ui";
import { describe, expect, it, vi } from "vitest";
import type { UiPort } from "./portHub";
import { createUiSnapshotBroadcaster } from "./snapshotBroadcaster";

const buildSnapshotEvent = (version: number): UiEventEnvelope => ({
  type: "ui:event",
  event: UI_EVENT_SNAPSHOT_CHANGED,
  payload: { version },
  context: { namespace: "eip155", chainRef: "eip155:1" },
});

describe("createUiSnapshotBroadcaster", () => {
  it("does not let an initial snapshot consume a queued broadcast", async () => {
    let version = 0;
    const broadcast = vi.fn();
    const send = vi.fn();
    const broadcaster = createUiSnapshotBroadcaster({
      portHub: { broadcast, send },
      buildSnapshotEvent: () => buildSnapshotEvent(version),
    });

    await broadcaster.withResponseFence(async () => {
      version = 1;
      broadcaster.requestBroadcast();
      broadcaster.sendInitialSnapshot({} as UiPort);
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toMatchObject({ payload: { version: 1 } });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0]?.[0]).toMatchObject({ payload: { version: 1 } });
  });
});
