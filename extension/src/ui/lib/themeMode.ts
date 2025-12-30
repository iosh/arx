import { useSyncExternalStore } from "react";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "arx:ui:themeMode";

type Listener = () => void;

const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function readThemeMode(): ThemeMode {
  const raw = safeGetItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function setThemeMode(next: ThemeMode) {
  safeSetItem(STORAGE_KEY, next);
  emit();
}

export function useThemeMode() {
  const themeMode = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readThemeMode,
    readThemeMode,
  );

  return { themeMode, setThemeMode };
}
