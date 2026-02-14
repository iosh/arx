export type RuntimeLifecycle = {
  getIsHydrating(): boolean;
  getIsDestroyed(): boolean;
  initialize(run: () => Promise<void>): Promise<void>;
  start(run: () => void): void;
  destroy(run: () => void): void;
  withHydration<T>(run: () => Promise<T>): Promise<T>;
};

export const createRuntimeLifecycle = (label: string): RuntimeLifecycle => {
  let destroyed = false;
  let initialized = false;
  let initializePromise: Promise<void> | null = null;
  let isHydrating = true;

  const getIsDestroyed = () => destroyed;
  const getIsHydrating = () => isHydrating;

  const withHydration = async <T>(run: () => Promise<T>): Promise<T> => {
    isHydrating = true;
    try {
      return await run();
    } finally {
      isHydrating = false;
    }
  };

  const initialize = async (run: () => Promise<void>) => {
    if (initialized || destroyed) {
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
    if (destroyed) {
      throw new Error(`${label} lifecycle cannot start after destroy()`);
    }

    if (!initialized) {
      throw new Error(`${label}.lifecycle.initialize() must complete before start()`);
    }

    run();
  };

  const destroy = (run: () => void) => {
    if (destroyed) {
      return;
    }

    destroyed = true;
    run();
  };

  return {
    getIsHydrating,
    getIsDestroyed,
    initialize,
    start,
    destroy,
    withHydration,
  };
};
