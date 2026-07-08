export type RuntimeLifecycle = {
  getIsHydrating(): boolean;
  getIsInitialized(): boolean;
  initialize(run: () => Promise<void>): Promise<void>;
  start(run: () => void): void;
  withHydration<T>(run: () => Promise<T>): Promise<T>;
};

export const createRuntimeLifecycle = (label: string): RuntimeLifecycle => {
  let initialized = false;
  let initializePromise: Promise<void> | null = null;
  let hydrationDepth = 0;

  const getIsHydrating = () => hydrationDepth > 0;
  const getIsInitialized = () => initialized;

  const withHydration = async <T>(run: () => Promise<T>): Promise<T> => {
    hydrationDepth += 1;
    try {
      return await run();
    } finally {
      hydrationDepth = Math.max(0, hydrationDepth - 1);
    }
  };

  const initialize = async (run: () => Promise<void>) => {
    if (initialized) {
      return;
    }

    if (initializePromise) {
      await initializePromise;
      return;
    }

    initializePromise = (async () => {
      await run();
      initialized = true;
    })();

    try {
      await initializePromise;
    } finally {
      initializePromise = null;
    }
  };

  const start = (run: () => void) => {
    if (!initialized) {
      throw new Error(`${label}.lifecycle.initialize() must complete before start()`);
    }

    run();
  };

  return {
    getIsHydrating,
    getIsInitialized,
    initialize,
    start,
    withHydration,
  };
};
