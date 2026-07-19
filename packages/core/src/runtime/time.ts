export type CoreTime = Readonly<{
  now(): number;
  schedule(delayMs: number, task: () => void): () => void;
}>;

export const systemTime: CoreTime = {
  now: () => Date.now(),
  schedule: (delayMs, task) => {
    const timer = setTimeout(task, delayMs);
    return () => clearTimeout(timer);
  },
};
