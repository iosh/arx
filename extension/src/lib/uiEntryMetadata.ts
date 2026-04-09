export const UI_ENVIRONMENTS = ["popup", "notification", "onboarding"] as const;
export type UiEnvironment = (typeof UI_ENVIRONMENTS)[number];

export const UI_ENTRY_REASONS = [
  "manual_open",
  "install",
  "onboarding_required",
  "approval_created",
  "unlock_required",
] as const;
export type UiEntryReason = (typeof UI_ENTRY_REASONS)[number];

export type UiEntryContext = {
  approvalId: string | null;
  origin: string | null;
  method: string | null;
  chainRef: string | null;
  namespace: string | null;
};

export type UiEntryMetadata = {
  environment: UiEnvironment;
  reason: UiEntryReason;
  context: UiEntryContext;
};

type UiEntryMetadataListener = () => void;

const UI_ENVIRONMENT_SET: ReadonlySet<string> = new Set(UI_ENVIRONMENTS);
const UI_ENTRY_REASON_SET: ReadonlySet<string> = new Set(UI_ENTRY_REASONS);
const UI_ENVIRONMENT_META_NAME = "arx:uiEnvironment";
const EMPTY_UI_ENTRY_CONTEXT: UiEntryContext = {
  approvalId: null,
  origin: null,
  method: null,
  chainRef: null,
  namespace: null,
};

let cachedEnvironment: UiEnvironment | null = null;
let cachedMetadata: UiEntryMetadata | null = null;
const metadataListeners = new Set<UiEntryMetadataListener>();

const toNonEmptyString = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const parseUiEnvironment = (value: string): UiEnvironment | null => {
  return UI_ENVIRONMENT_SET.has(value) ? (value as UiEnvironment) : null;
};

export const parseUiEntryReason = (value: string): UiEntryReason | null => {
  return UI_ENTRY_REASON_SET.has(value) ? (value as UiEntryReason) : null;
};

const readMetaContent = (name: string): string => {
  if (typeof document === "undefined") {
    throw new Error("document is not available");
  }

  const meta = document.querySelector(`meta[name="${name}"]`);
  const content = meta?.getAttribute("content");
  const normalized = toNonEmptyString(content);

  if (!normalized) {
    throw new Error(`Missing <meta name="${name}" content="...">`);
  }

  return normalized;
};

export const readUiEnvironmentFromMeta = (): UiEnvironment => {
  const content = readMetaContent(UI_ENVIRONMENT_META_NAME);
  const environment = parseUiEnvironment(content);

  if (!environment) {
    throw new Error(`Invalid ${UI_ENVIRONMENT_META_NAME}: ${content}`);
  }

  return environment;
};

export const getUiEnvironment = (): UiEnvironment => {
  if (cachedEnvironment) {
    return cachedEnvironment;
  }

  cachedEnvironment = readUiEnvironmentFromMeta();
  return cachedEnvironment;
};

export const createUiEntryMetadata = (input: {
  environment: UiEnvironment;
  reason: UiEntryReason;
  context?: Partial<UiEntryContext>;
}): UiEntryMetadata => {
  return {
    environment: input.environment,
    reason: input.reason,
    context: {
      approvalId: toNonEmptyString(input.context?.approvalId) ?? EMPTY_UI_ENTRY_CONTEXT.approvalId,
      origin: toNonEmptyString(input.context?.origin) ?? EMPTY_UI_ENTRY_CONTEXT.origin,
      method: toNonEmptyString(input.context?.method) ?? EMPTY_UI_ENTRY_CONTEXT.method,
      chainRef: toNonEmptyString(input.context?.chainRef) ?? EMPTY_UI_ENTRY_CONTEXT.chainRef,
      namespace: toNonEmptyString(input.context?.namespace) ?? EMPTY_UI_ENTRY_CONTEXT.namespace,
    },
  };
};

export const hydrateUiEntryMetadata = (metadata: UiEntryMetadata): UiEntryMetadata => {
  cachedMetadata = createUiEntryMetadata(metadata);
  cachedEnvironment = cachedMetadata.environment;

  for (const listener of metadataListeners) {
    listener();
  }

  return cachedMetadata;
};

export const getUiEntryMetadata = (): UiEntryMetadata => {
  if (!cachedMetadata) {
    throw new Error("UI entry metadata has not been bootstrapped");
  }

  return cachedMetadata;
};

export const clearUiEntryMetadataCache = (): void => {
  cachedEnvironment = null;
  cachedMetadata = null;

  for (const listener of metadataListeners) {
    listener();
  }
};

export const subscribeUiEntryMetadata = (listener: UiEntryMetadataListener): (() => void) => {
  metadataListeners.add(listener);
  return () => metadataListeners.delete(listener);
};
