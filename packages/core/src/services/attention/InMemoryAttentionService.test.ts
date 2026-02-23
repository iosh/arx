import { describe, expect, it } from "vitest";
import { Messenger } from "../../messenger/Messenger.js";
import { InMemoryAttentionService } from "./InMemoryAttentionService.js";
import { ATTENTION_REQUESTED, ATTENTION_STATE_CHANGED, ATTENTION_TOPICS } from "./topics.js";

const setup = (opts?: { maxQueueSize?: number }) => {
  let t = 1_000;
  const messenger = new Messenger().scope({ publish: ATTENTION_TOPICS });
  const requested: unknown[] = [];
  const stateChanged: unknown[] = [];
  messenger.subscribe(ATTENTION_REQUESTED, (p) => requested.push(p));
  messenger.subscribe(ATTENTION_STATE_CHANGED, (p) => stateChanged.push(p));
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
