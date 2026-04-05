import { createBackgroundRoot } from "./backgroundRoot";

export const createBackgroundApp = () => {
  const root = createBackgroundRoot();

  const start = async () => await root.initialize();
  const stop = async () => await root.shutdown();

  return { start, stop };
};
