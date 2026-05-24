import { createBackgroundRoot } from "./backgroundRoot";

export const createBackgroundApp = () => {
  const root = createBackgroundRoot();

  const start = async () => await root.initialize();

  return { start };
};
