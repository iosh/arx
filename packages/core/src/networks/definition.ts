import { z } from "zod";
import { type ParsedChainRef, parseChainRef } from "./chainRef.js";
import type { BlockExplorer, ChainDefinition, NativeCurrency } from "./types.js";

export type NamespaceChainDefinitionValidator = (params: {
  definition: ChainDefinition;
  parsed: ParsedChainRef;
  ctx: z.RefinementCtx;
}) => void;

export const cloneChainDefinition = (definition: ChainDefinition): ChainDefinition => ({
  chainRef: definition.chainRef,
  name: definition.name,
  nativeCurrency: {
    name: definition.nativeCurrency.name,
    symbol: definition.nativeCurrency.symbol,
    decimals: definition.nativeCurrency.decimals,
  },
  ...(definition.blockExplorers
    ? {
        blockExplorers: definition.blockExplorers.map((explorer) => ({
          url: explorer.url,
          ...(explorer.name !== undefined ? { name: explorer.name } : {}),
        })),
      }
    : {}),
  ...(definition.iconUrl !== undefined ? { iconUrl: definition.iconUrl } : {}),
});

const trimmedString = () =>
  z
    .string()
    .min(1)
    .refine((value) => value.trim() === value, { message: "Value must not include leading or trailing whitespace" });

const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "URL must use the http or https protocol");

const nativeCurrencySchema: z.ZodType<NativeCurrency> = z.strictObject({
  name: trimmedString(),
  symbol: trimmedString(),
  decimals: z.number().int().min(0),
});

const blockExplorerSchema: z.ZodType<BlockExplorer> = z.strictObject({
  url: httpUrlSchema,
  name: trimmedString().optional(),
});

const chainDefinitionBaseSchema: z.ZodType<ChainDefinition> = z.strictObject({
  chainRef: z.string(),
  name: trimmedString(),
  nativeCurrency: nativeCurrencySchema,
  blockExplorers: z.array(blockExplorerSchema).optional(),
  iconUrl: httpUrlSchema.optional(),
});

export const createChainDefinitionSchema = (options?: {
  namespaceValidators?: Readonly<Record<string, NamespaceChainDefinitionValidator>>;
}): z.ZodType<ChainDefinition> => {
  const validators = options?.namespaceValidators ?? {};
  return chainDefinitionBaseSchema.superRefine((value, ctx) => {
    let parsed: ParsedChainRef;
    try {
      parsed = parseChainRef(value.chainRef);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: (error as Error).message,
        path: ["chainRef"],
      });
      return;
    }

    validators[parsed.namespace]?.({ definition: value, parsed, ctx });

    if (value.blockExplorers) {
      const explorerUrls = new Set<string>();
      for (const explorer of value.blockExplorers) {
        if (explorerUrls.has(explorer.url)) {
          ctx.addIssue({
            code: "custom",
            message: `Duplicate block explorer URL: ${explorer.url}`,
            path: ["blockExplorers"],
          });
        }
        explorerUrls.add(explorer.url);
      }
    }
  });
};

const chainDefinitionSchema = createChainDefinitionSchema();

export const validateChainDefinition = (definition: unknown): ChainDefinition =>
  chainDefinitionSchema.parse(definition);

const isSameNativeCurrency = (previous: NativeCurrency, next: NativeCurrency): boolean =>
  previous.name === next.name && previous.symbol === next.symbol && previous.decimals === next.decimals;

const isSameBlockExplorer = (previous: BlockExplorer, next: BlockExplorer): boolean =>
  previous.url === next.url && previous.name === next.name;

export const isSameChainDefinition = (previous: ChainDefinition, next: ChainDefinition): boolean => {
  if (
    previous.chainRef !== next.chainRef ||
    previous.name !== next.name ||
    previous.iconUrl !== next.iconUrl ||
    !isSameNativeCurrency(previous.nativeCurrency, next.nativeCurrency)
  ) {
    return false;
  }

  const previousExplorers = previous.blockExplorers;
  const nextExplorers = next.blockExplorers;
  if (!previousExplorers || !nextExplorers) return previousExplorers === nextExplorers;
  if (previousExplorers.length !== nextExplorers.length) return false;

  return previousExplorers.every((explorer, index) => {
    const nextExplorer = nextExplorers[index];
    return nextExplorer !== undefined && isSameBlockExplorer(explorer, nextExplorer);
  });
};
