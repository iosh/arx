import { describe, expect, it } from "vitest";
import { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import { InMemoryAttentionService } from "./InMemoryAttentionService.js";
import type { AttentionServiceMessengerTopics } from "./types.js";

const setup = (opts?: { maxQueueSize?: number }) => {
  let t = 1_000;
  const messenger = new ControllerMessenger<AttentionServiceMessengerTopics>({});
  const requested: unknown[] = [];
  const stateChanged: unknown[] = [];
  messenger.subscribe("attention:requested", (p) => requested.push(p));
  messenger.subscribe("attention:stateChanged", (p) => stateChanged.push(p));
  const service = new InMemoryAttentionService({
    messenger,
    now: () => t,
    ...(opts?.maxQueueSize !== undefined ? { maxQueueSize: opts.maxQueueSize } : {}),
  });
  return {
    service,
    requested,
    stateChanged,
    setTime: (next: number) => {
      t = next;
    },
  };
};

describe("InMemoryAttentionService", () => {
  it("publishes requested + stateChanged when enqueued", () => {
    const { service, requested, stateChanged } = setup();
    const res = service.requestAttention({
      reason: "unlock_required",
      origin: "https://dapp",
      method: "eth_requestAccounts",
    });
    expect(res.enqueued).toBe(true);
    expect(requested.length).toBe(1);
    expect(stateChanged.length).toBe(1);
    expect(res.state.count).toBe(res.state.queue.length);
  });

  it("dedups within TTL without changing state", () => {
    const { service, requested, stateChanged } = setup();
    service.requestAttention({ reason: "unlock_required", origin: "https://dapp", method: "eth_requestAccounts" });

    const beforeR = requested.length;
    const beforeS = stateChanged.length;

    const res = service.requestAttention({
      reason: "unlock_required",
      origin: "https://dapp",
      method: "eth_requestAccounts",
    });

    expect(res.enqueued).toBe(false);
    expect(requested.length).toBe(beforeR + 1);
    expect(stateChanged.length).toBe(beforeS);
  });

  it("clearExpired removes entries and publishes stateChanged once", () => {
    const { service, stateChanged, setTime } = setup();
    service.requestAttention({
      reason: "unlock_required",
      origin: "https://dapp",
      method: "eth_requestAccounts",
      ttlMs: 10,
    });
    const before = stateChanged.length;
    setTime(1_011);
    const next = service.clearExpired();
    expect(next.count).toBe(0);
    expect(stateChanged.length).toBe(before + 1);
  });

  it("enforces maxQueueSize with FIFO eviction", () => {
    const { service } = setup({ maxQueueSize: 2 });
    service.requestAttention({ reason: "unlock_required", origin: "https://dapp", method: "m1" });
    service.requestAttention({ reason: "unlock_required", origin: "https://dapp", method: "m2" });
    service.requestAttention({ reason: "unlock_required", origin: "https://dapp", method: "m3" });
    const snap = service.getSnapshot();
    expect(snap.count).toBe(2);
    expect(snap.queue.map((r) => r.method)).toEqual(["m2", "m3"]);
  });

  it("does not double-publish stateChanged when pruning expired entries during requestAttention", () => {
    const { service, stateChanged, setTime } = setup();

    service.requestAttention({
      reason: "unlock_required",
      origin: "https://dapp",
      method: "m1",
      ttlMs: 5,
    });

    setTime(1_006); // expire m1
    const before = stateChanged.length;

    service.requestAttention({
      reason: "unlock_required",
      origin: "https://dapp",
      method: "m2",
    });

    expect(stateChanged.length).toBe(before + 1);
  });

  it("accepts approval_required reason", () => {
    const { service, requested, stateChanged } = setup();
    const res = service.requestAttention({
      reason: "approval_required",
      origin: "https://dapp",
      method: "personal_sign",
    });

    expect(res.enqueued).toBe(true);
    expect(requested.length).toBe(1);
    expect(stateChanged.length).toBe(1);
  });
});
