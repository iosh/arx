export const ENTRY_INTENTS = ["manual_open", "attention_open", "onboarding_tab"] as const;
export type EntryIntent = (typeof ENTRY_INTENTS)[number];

const ENTRY_INTENT_SET: ReadonlySet<string> = new Set(ENTRY_INTENTS);

let cached: EntryIntent | null = null;

function isEntryIntent(value: string): value is EntryIntent {
  return ENTRY_INTENT_SET.has(value);
}

export function readEntryIntentFromMeta(): EntryIntent {
  if (typeof document === "undefined") {
    throw new Error("document is not available");
  }

  const meta = document.querySelector('meta[name="arx:entryIntent"]');
  const content = meta?.getAttribute("content")?.trim();

  if (!content) {
    throw new Error('Missing <meta name="arx:entryIntent" content="...">');
  }
  if (!isEntryIntent(content)) {
    throw new Error(`Invalid arx:entryIntent: ${content}`);
  }

  return content;
}

export function getEntryIntent(): EntryIntent {
  if (cached) return cached;
  cached = readEntryIntentFromMeta();
  return cached;
}
