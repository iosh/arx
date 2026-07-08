export type RuntimePlugin = {
  name: string;
  initialize?: () => Promise<void>;
  hydrate?: () => Promise<void>;
  afterHydration?: () => Promise<void>;
  start?: () => void;
};

export const runPluginHooks = async (
  plugins: RuntimePlugin[],
  hook: keyof Pick<RuntimePlugin, "initialize" | "hydrate" | "afterHydration">,
) => {
  for (const plugin of plugins) {
    const fn = plugin[hook];
    if (!fn) continue;
    await fn();
  }
};

export const startPlugins = (plugins: RuntimePlugin[]) => {
  for (const plugin of plugins) {
    plugin.start?.();
  }
};
