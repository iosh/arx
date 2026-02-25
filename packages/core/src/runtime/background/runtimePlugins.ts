export type RuntimePlugin = {
  name: string;
  initialize?: () => Promise<void>;
  hydrate?: () => Promise<void>;
  afterHydration?: () => Promise<void>;
  start?: () => void;
  destroy?: () => void;
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

export const destroyPlugins = (plugins: RuntimePlugin[]) => {
  for (const plugin of [...plugins].reverse()) {
    try {
      plugin.destroy?.();
    } catch {
      // best-effort
    }
  }
};
