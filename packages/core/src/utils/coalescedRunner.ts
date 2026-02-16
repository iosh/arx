export const createCoalescedRunner = (runner: () => Promise<void>): (() => Promise<void>) => {
  let executing: Promise<void> | null = null;
  let queued = false;

  const ensureExecuting = () => {
    if (executing) return executing;

    executing = (async () => {
      try {
        while (queued) {
          queued = false;
          try {
            await runner();
          } catch {
            // Best-effort: callers should log/handle errors at the call site.
          }
        }
      } finally {
        executing = null;
      }
    })();

    return executing;
  };

  return async () => {
    queued = true;

    if (executing) {
      await executing;
      // If a caller queued another run right as the previous one was ending,
      // `queued` can remain true after `executing` resolves. Ensure we drain it.
      if (queued) {
        await ensureExecuting();
      }
      return;
    }

    await ensureExecuting();
  };
};
