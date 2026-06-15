import { z } from "zod";
import { type ParsedChainRef, parseChainRef } from "./caip.js";
import type { ChainRef } from "./ids.js";
import { ChainRefSchema } from "./ids.js";
import { HTTP_PROTOCOLS, isUrlWithProtocols } from "./url.js";

export interface ChainIcon {
  url: string;
  width?: number | undefined;
  height?: number | undefined;
  format?: "svg" | "png" | "jpg" | "jpeg" | "webp" | undefined;
}

export interface ExplorerLink {
  type: string;
  url: string;
  title?: string | undefined;
}

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface ChainDefinition {
  chainRef: ChainRef;
  displayName: string;
  shortName?: string | undefined;
  nativeCurrency: NativeCurrency;
  blockExplorers?: readonly ExplorerLink[] | undefined;
  icon?: ChainIcon | undefined;
}

export type NamespaceChainDefinitionValidator = (params: {
  definition: ChainDefinition;
  parsed: ParsedChainRef;
  ctx: z.RefinementCtx;
}) => void;

export type ChainDefinitionSeed<TRpcEndpoint = unknown> = {
  definition: ChainDefinition;
  defaultRpcEndpoints?: readonly TRpcEndpoint[] | undefined;
};

export const defineChainDefinitionSeed = <const TSeed extends ChainDefinitionSeed>(seed: TSeed): TSeed => seed;

export const defineChainDefinitionSeeds = <const TSeeds extends readonly ChainDefinitionSeed[]>(
  seeds: TSeeds,
): TSeeds => seeds;

export const cloneChainDefinition = (definition: ChainDefinition): ChainDefinition => ({
  chainRef: definition.chainRef,
  displayName: definition.displayName,
  shortName: definition.shortName,
  nativeCurrency: {
    name: definition.nativeCurrency.name,
    symbol: definition.nativeCurrency.symbol,
    decimals: definition.nativeCurrency.decimals,
  },
  blockExplorers: definition.blockExplorers
    ? definition.blockExplorers.map((explorer) => ({
        type: explorer.type,
        url: explorer.url,
        title: explorer.title,
      }))
    : undefined,
  icon: definition.icon
    ? {
        url: definition.icon.url,
        width: definition.icon.width,
        height: definition.icon.height,
        format: definition.icon.format,
      }
    : undefined,
});

const trimmedString = () =>
  z
    .string()
    .min(1)
    .refine((value) => value.trim() === value, { message: "Value must not include leading or trailing whitespace" });

const httpUrlSchema = z.url().refine((value) => isUrlWithProtocols(value, HTTP_PROTOCOLS), {
  message: "URL must use the http or https protocol",
});

const nativeCurrencySchema: z.ZodType<NativeCurrency> = z.strictObject({
  name: trimmedString(),
  symbol: trimmedString(),
  decimals: z.number().int().min(0),
});

export const explorerLinkSchema: z.ZodType<ExplorerLink> = z.strictObject({
  type: trimmedString(),
  url: httpUrlSchema,
  title: trimmedString().optional(),
});

export const chainIconSchema: z.ZodType<ChainIcon> = z.strictObject({
  url: httpUrlSchema,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  format: z.enum(["svg", "png", "jpg", "jpeg", "webp"]).optional(),
});

const chainDefinitionBaseSchema: z.ZodType<ChainDefinition> = z.strictObject({
  chainRef: ChainRefSchema,
  displayName: trimmedString(),
  shortName: trimmedString().optional(),
  nativeCurrency: nativeCurrencySchema,
  blockExplorers: z.array(explorerLinkSchema).optional(),
  icon: chainIconSchema.optional(),
});

export const createChainDefinitionSchema = (options?: {
  namespaceValidators?: Record<string, NamespaceChainDefinitionValidator>;
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

export const chainDefinitionSchema = createChainDefinitionSchema();

export const validateChainDefinition = (definition: unknown): ChainDefinition => {
  return chainDefinitionSchema.parse(definition);
};

export const normalizeChainDefinition = (definition: ChainDefinition): ChainDefinition => {
  const cloned = cloneChainDefinition(validateChainDefinition(definition));
  cloned.displayName = cloned.displayName.trim();
  if (cloned.shortName) {
    const trimmed = cloned.shortName.trim();
    cloned.shortName = trimmed.length > 0 ? trimmed : undefined;
  }

  cloned.nativeCurrency = {
    name: cloned.nativeCurrency.name.trim(),
    symbol: cloned.nativeCurrency.symbol.trim(),
    decimals: cloned.nativeCurrency.decimals,
  };

  if (cloned.blockExplorers) {
    cloned.blockExplorers = cloned.blockExplorers.map((explorer) => ({
      ...explorer,
      url: explorer.url.trim(),
      type: explorer.type.trim(),
      title: (() => {
        const trimmed = explorer.title?.trim();
        return trimmed && trimmed.length > 0 ? trimmed : undefined;
      })(),
    }));
  }

  if (cloned.icon) {
    cloned.icon = { ...cloned.icon, url: cloned.icon.url.trim() };
  }

  return cloned;
};

const isSameExplorerLink = (previous: ExplorerLink, next: ExplorerLink) => {
  return previous.type === next.type && previous.url === next.url && previous.title === next.title;
};

const isSameNativeCurrency = (previous: NativeCurrency, next: NativeCurrency) => {
  return previous.name === next.name && previous.symbol === next.symbol && previous.decimals === next.decimals;
};

const isSameIcon = (previous: ChainIcon | undefined, next: ChainIcon | undefined) => {
  if (!previous && !next) return true;
  if (!previous || !next) return false;
  return (
    previous.url === next.url &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.format === next.format
  );
};

export const isSameChainDefinition = (previous: ChainDefinition, next: ChainDefinition): boolean => {
  if (
    previous.chainRef !== next.chainRef ||
    previous.displayName !== next.displayName ||
    previous.shortName !== next.shortName
  ) {
    return false;
  }

  if (!isSameNativeCurrency(previous.nativeCurrency, next.nativeCurrency)) {
    return false;
  }

  const prevExplorers = previous.blockExplorers;
  const nextExplorers = next.blockExplorers;
  if (!prevExplorers && nextExplorers) return false;
  if (prevExplorers && !nextExplorers) return false;
  if (prevExplorers && nextExplorers) {
    if (prevExplorers.length !== nextExplorers.length) return false;
    for (let i = 0; i < prevExplorers.length; i += 1) {
      const prevExplorer = prevExplorers[i];
      const nextExplorer = nextExplorers[i];
      if (!prevExplorer || !nextExplorer) return false;
      if (!isSameExplorerLink(prevExplorer, nextExplorer)) {
        return false;
      }
    }
  }

  return isSameIcon(previous.icon, next.icon);
};
