export type Unsubscribe = () => void;

export const createSignal = <T>(options?: { onListenerError?: (error: unknown) => void }) => {
  const listeners = new Set<(payload: T) => void>();
  const onListenerError = options?.onListenerError ?? null;

  return {
    subscribe(fn: (payload: T) => void): Unsubscribe {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(payload: T): void {
      for (const fn of listeners) {
        try {
          fn(payload);
        } catch (error) {
          try {
            onListenerError?.(error);
          } catch {}
        }
      }
    },
    clear(): void {
      listeners.clear();
    },
  };
};
