import { describe, expect, it, vi } from "vitest";
import { createCoreMutationQueue } from "./mutationQueue.js";

describe("createCoreMutationQueue", () => {
  it("runs mutations in FIFO order", async () => {
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const writer = {
      commit: vi.fn(async () => undefined),
    };
    const queue = createCoreMutationQueue(writer);

    const first = queue.run(async (commit) => {
      events.push("first:start");
      await firstGate;
      await commit([]);
      events.push("first:end");
      return 1;
    });
    const second = queue.run(async (commit) => {
      events.push("second:start");
      await commit([]);
      events.push("second:end");
      return 2;
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    releaseFirst?.();

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
    expect(writer.commit).toHaveBeenCalledTimes(2);
  });

  it("continues after a mutation fails", async () => {
    const failure = new Error("mutation failed");
    const writer = {
      commit: vi.fn(async () => undefined),
    };
    const queue = createCoreMutationQueue(writer);

    const failed = queue.run(async () => {
      throw failure;
    });
    const next = queue.run(async (commit) => {
      await commit([]);
      return "completed";
    });

    await expect(failed).rejects.toBe(failure);
    await expect(next).resolves.toBe("completed");
    expect(writer.commit).toHaveBeenCalledOnce();
  });
});
