import { useSyncExternalStore } from "react";

export type ToastKind = "success" | "info" | "warning" | "error";

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
  dedupeKey?: string;
  durationMs: number;
  createdAt: number;
  updatedAt: number;
};

type ToastInput = {
  kind: ToastKind;
  message: string;
  dedupeKey?: string;
  durationMs?: number;
};

type Listener = () => void;

const MAX_VISIBLE = 3;

const DEFAULT_DURATION_MS: Record<ToastKind, number> = {
  success: 2000,
  info: 2000,
  warning: 3000,
  error: 4000,
};

const listeners = new Set<Listener>();
let toasts: Toast[] = [];

// React requires that getSnapshot returns a stable reference when the store state hasn't changed.
let cachedSnapshot = {
  toasts,
  visibleToasts: toasts.slice(0, MAX_VISIBLE),
  maxVisible: MAX_VISIBLE,
};

function updateSnapshot(nextToasts: Toast[]) {
  cachedSnapshot = {
    toasts: nextToasts,
    visibleToasts: nextToasts.slice(0, MAX_VISIBLE),
    maxVisible: MAX_VISIBLE,
  };
}

function getSnapshot() {
  return cachedSnapshot;
}

// dedupeKey -> toastId
const dedupeIndex = new Map<string, string>();

// toastId -> timeout handle (only for visible toasts)
const timeoutHandles = new Map<string, ReturnType<typeof setTimeout>>();

// toastId -> updatedAt value that the current timer corresponds to
const scheduledForUpdatedAt = new Map<string, number>();

function emit() {
  for (const listener of listeners) listener();
}
function safeRandomId() {
  return crypto.randomUUID();
}

function getVisibleIds(nextToasts: Toast[]) {
  return new Set(nextToasts.slice(0, MAX_VISIBLE).map((t) => t.id));
}

function clearTimer(toastId: string) {
  const handle = timeoutHandles.get(toastId);
  if (handle) clearTimeout(handle);
  timeoutHandles.delete(toastId);
  scheduledForUpdatedAt.delete(toastId);
}

function reconcileTimers(nextToasts: Toast[]) {
  const visibleIds = getVisibleIds(nextToasts);

  for (const toastId of timeoutHandles.keys()) {
    if (!visibleIds.has(toastId)) {
      clearTimer(toastId);
    }
  }

  for (const toast of nextToasts.slice(0, MAX_VISIBLE)) {
    const scheduledAt = scheduledForUpdatedAt.get(toast.id);
    if (scheduledAt === toast.updatedAt && timeoutHandles.has(toast.id)) continue;

    clearTimer(toast.id);

    const duration = Math.max(0, toast.durationMs);
    const handle = setTimeout(() => {
      dismissToast(toast.id);
    }, duration);

    timeoutHandles.set(toast.id, handle);
    scheduledForUpdatedAt.set(toast.id, toast.updatedAt);
  }
}

export function pushToast(input: ToastInput): string {
  const now = Date.now();
  const durationMs = input.durationMs ?? DEFAULT_DURATION_MS[input.kind];

  if (input.dedupeKey) {
    const existingId = dedupeIndex.get(input.dedupeKey);
    if (existingId) {
      const existingIndex = toasts.findIndex((t) => t.id === existingId);
      if (existingIndex >= 0) {
        const existing = toasts[existingIndex];
        const updated: Toast = {
          ...existing,
          kind: input.kind,
          message: input.message,
          durationMs,
          updatedAt: now,
        };

        // Move to newest position (front)
        const next = toasts.slice();
        next.splice(existingIndex, 1);
        next.unshift(updated);

        toasts = next;
        updateSnapshot(toasts);
        reconcileTimers(toasts);
        emit();
        return updated.id;
      }

      // Stale mapping (toast no longer exists)
      dedupeIndex.delete(input.dedupeKey);
    }
  }

  const toast: Toast = {
    id: safeRandomId(),
    kind: input.kind,
    message: input.message,
    dedupeKey: input.dedupeKey,
    durationMs,
    createdAt: now,
    updatedAt: now,
  };

  if (toast.dedupeKey) dedupeIndex.set(toast.dedupeKey, toast.id);

  toasts = [toast, ...toasts];
  updateSnapshot(toasts);
  reconcileTimers(toasts);
  emit();
  return toast.id;
}

export function dismissToast(id: string) {
  const index = toasts.findIndex((t) => t.id === id);
  if (index < 0) return;

  const toast = toasts[index];
  const next = toasts.slice();
  next.splice(index, 1);
  toasts = next;
  updateSnapshot(toasts);

  clearTimer(id);
  if (toast.dedupeKey && dedupeIndex.get(toast.dedupeKey) === id) {
    dedupeIndex.delete(toast.dedupeKey);
  }

  reconcileTimers(toasts);
  emit();
}

export function clearToasts() {
  toasts = [];
  updateSnapshot(toasts);
  dedupeIndex.clear();
  for (const toastId of timeoutHandles.keys()) clearTimer(toastId);
  emit();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToasts() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
