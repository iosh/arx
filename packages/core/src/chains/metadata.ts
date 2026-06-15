import { z } from "zod";
import { type ParsedChainRef, parseChainRef } from "./caip.js";
import type { ChainDefinition, ChainDefinitionSeed, ChainIcon, ExplorerLink, NativeCurrency } from "./definition.js";
import { chainIconSchema, cloneChainDefinition, explorerLinkSchema } from "./definition.js";
import { eip155ChainRefFromChainIdHex } from "./eip155/format.js";
import { type ChainRef, ChainRefSchema } from "./ids.js";
import { isUrlWithProtocols, RPC_PROTOCOLS } from "./url.js";

export type {
  ChainDefinition,
  ChainDefinitionSeed,
  ChainIcon,
  ExplorerLink,
  NativeCurrency,
} from "./definition.js";
export {
  chainDefinitionSchema,
  cloneChainDefinition,
  createChainDefinitionSchema,
  isSameChainDefinition,
  normalizeChainDefinition,
  validateChainDefinition,
} from "./definition.js";

export interface RpcEndpoint {
  url: string;
  type?: "public" | "authenticated" | "private" | undefined;
  weight?: number | undefined;
  headers?: Record<string, string> | undefined;
}

export interface ChainMetadata {
  chainRef: ChainRef;
  namespace: string;
  chainId: string;
  displayName: string;
  shortName?: string | undefined;
  nativeCurrency: NativeCurrency;
  blockExplorers?: readonly ExplorerLink[] | undefined;
  icon?: ChainIcon | undefined;
}

export type NamespaceMetadataValidator = (params: {
  metadata: ChainMetadata;
  parsed: ParsedChainRef;
  ctx: z.RefinementCtx;
}) => void;

export type ChainMetadataSchemaOptions = {
  namespaceValidators?: Record<string, NamespaceMetadataValidator>;
  allowDuplicateShortNames?: boolean;
};

const trimmedString = () =>
  z
    .string()
    .min(1)
    .refine((value) => value.trim() === value, { message: "Value must not include leading or trailing whitespace" });

const rpcUrlSchema = z.url().refine((value) => isUrlWithProtocols(value, RPC_PROTOCOLS), {
  message: "URL must use http, https, ws, or wss protocol",
});

const chainIdSchema = z
  .string({ error: "Chain metadata must include chainId" })
  .min(1)
  .refine((value) => value.trim() === value, { message: "Value must not include leading or trailing whitespace" });

export const rpcEndpointSchema: z.ZodType<RpcEndpoint> = z.strictObject({
  url: rpcUrlSchema,
  type: z.enum(["public", "authenticated", "private"]).optional(),
  weight: z.number().positive().optional(),
  headers: z.record(trimmedString(), z.string()).optional(),
});

const nativeCurrencySchema: z.ZodType<NativeCurrency> = z.strictObject({
  name: trimmedString(),
  symbol: trimmedString(),
  decimals: z.number().int().min(0),
});

const baseSchema: z.ZodType<ChainMetadata> = z.strictObject({
  chainRef: ChainRefSchema,
  namespace: trimmedString(),
  chainId: chainIdSchema,
  displayName: trimmedString(),
  shortName: trimmedString().optional(),
  nativeCurrency: nativeCurrencySchema,
  blockExplorers: z.array(explorerLinkSchema).optional(),
  icon: chainIconSchema.optional(),
});

const defaultNamespaceValidators: Record<string, NamespaceMetadataValidator> = {
  eip155: ({ metadata, parsed, ctx }) => {
    let chainRefFromChainId: ChainRef;
    try {
      chainRefFromChainId = eip155ChainRefFromChainIdHex(metadata.chainId);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "EIP-155 metadata must include a hex chainId",
        path: ["chainId"],
      });
      return;
    }

    if (chainRefFromChainId !== metadata.chainRef) {
      ctx.addIssue({
        code: "custom",
        message: `chainId (${metadata.chainId}) does not match CAIP-2 reference (${parsed.reference})`,
        path: ["chainId"],
      });
    }
  },
};

export const createChainMetadataSchema = (options?: {
  namespaceValidators?: Record<string, NamespaceMetadataValidator>;
}): z.ZodType<ChainMetadata> => {
  const validators = { ...defaultNamespaceValidators, ...(options?.namespaceValidators ?? {}) };
  return baseSchema.superRefine((value, ctx) => {
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

    if (parsed.namespace !== value.namespace) {
      ctx.addIssue({
        code: "custom",
        message: `Chain namespace "${value.namespace}" does not match CAIP-2 namespace "${parsed.namespace}"`,
        path: ["namespace"],
      });
    }

    const validator = validators[parsed.namespace];
    validator?.({ metadata: value, parsed, ctx });

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

export const createChainMetadataListSchema = (options?: ChainMetadataSchemaOptions) => {
  const itemSchema = createChainMetadataSchema(options);
  return z.array(itemSchema).superRefine((items, ctx) => {
    const chainRefs = new Map<string, number>();
    const shortNames = new Map<string, number>();

    items.forEach((item, index) => {
      const duplicateRef = chainRefs.get(item.chainRef);
      if (duplicateRef !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate chainRef detected: ${item.chainRef}`,
          path: [index, "chainRef"],
        });
      } else {
        chainRefs.set(item.chainRef, index);
      }

      if (options?.allowDuplicateShortNames || !item.shortName) {
        return;
      }

      const key = item.shortName.toLowerCase();
      const duplicateShort = shortNames.get(key);
      if (duplicateShort !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate shortName detected: ${item.shortName}`,
          path: [index, "shortName"],
        });
      } else {
        shortNames.set(key, index);
      }
    });
  });
};

export const chainMetadataSchema = createChainMetadataSchema();
export const chainMetadataListSchema = createChainMetadataListSchema();

export const validateChainMetadata = (metadata: unknown): ChainMetadata => {
  return chainMetadataSchema.parse(metadata);
};

export const validateChainMetadataList = (metadataList: unknown): ChainMetadata[] => {
  return chainMetadataListSchema.parse(metadataList);
};

export const deriveChainDefinitionFromMetadata = (metadata: ChainMetadata): ChainDefinition =>
  cloneChainDefinition({
    chainRef: metadata.chainRef,
    displayName: metadata.displayName,
    shortName: metadata.shortName,
    nativeCurrency: metadata.nativeCurrency,
    blockExplorers: metadata.blockExplorers,
    icon: metadata.icon,
  });

export const deriveChainDefinitionSeedFromMetadata = (metadata: ChainMetadata): ChainDefinitionSeed<RpcEndpoint> => ({
  definition: deriveChainDefinitionFromMetadata(metadata),
});

export const deriveChainMetadataFromDefinitionSeed = (params: {
  seed: ChainDefinitionSeed<RpcEndpoint>;
  namespace: string;
  chainId: string;
}): ChainMetadata => {
  const { definition } = params.seed;
  return validateChainMetadata({
    chainRef: definition.chainRef,
    namespace: params.namespace,
    chainId: params.chainId,
    displayName: definition.displayName,
    shortName: definition.shortName,
    nativeCurrency: definition.nativeCurrency,
    blockExplorers: definition.blockExplorers,
    icon: definition.icon,
  });
};

const normalizeComparableUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return trimmed;
  }
};

const normalizeComparableUrlList = (values: readonly string[] | undefined) => {
  if (!values) return undefined;

  const unique = new Set<string>();
  for (const value of values) {
    const normalized = normalizeComparableUrl(value);
    if (normalized) {
      unique.add(normalized);
    }
  }

  return [...unique].sort();
};

export const cloneChainMetadata = (metadata: ChainMetadata): ChainMetadata => ({
  chainRef: metadata.chainRef,
  namespace: metadata.namespace,
  chainId: metadata.chainId,
  displayName: metadata.displayName,
  shortName: metadata.shortName,
  nativeCurrency: {
    name: metadata.nativeCurrency.name,
    symbol: metadata.nativeCurrency.symbol,
    decimals: metadata.nativeCurrency.decimals,
  },
  blockExplorers: metadata.blockExplorers
    ? metadata.blockExplorers.map((explorer) => ({
        type: explorer.type,
        url: explorer.url,
        title: explorer.title,
      }))
    : undefined,
  icon: metadata.icon
    ? {
        url: metadata.icon.url,
        width: metadata.icon.width,
        height: metadata.icon.height,
        format: metadata.icon.format,
      }
    : undefined,
});

export const normalizeChainMetadata = (metadata: ChainMetadata): ChainMetadata => {
  const cloned = cloneChainMetadata(metadata);
  cloned.chainId = cloned.chainId.trim();
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

export const normalizeAddChainComparableMetadata = (metadata: ChainMetadata): ChainMetadata => {
  const normalized = normalizeChainMetadata(metadata);
  const explorerUrls = normalizeComparableUrlList(normalized.blockExplorers?.map((explorer) => explorer.url));

  return {
    chainRef: normalized.chainRef,
    namespace: normalized.namespace,
    chainId: normalized.namespace === "eip155" ? normalized.chainId.toLowerCase() : normalized.chainId,
    displayName: normalized.displayName,
    nativeCurrency: {
      name: normalized.nativeCurrency.name,
      symbol: normalized.nativeCurrency.symbol,
      decimals: normalized.nativeCurrency.decimals,
    },
    ...(explorerUrls && explorerUrls.length > 0
      ? {
          blockExplorers: explorerUrls.map((url) => ({ type: "default", url })),
        }
      : {}),
  };
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

export const isSameChainMetadata = (previous: ChainMetadata, next: ChainMetadata) => {
  if (
    previous.chainRef !== next.chainRef ||
    previous.namespace !== next.namespace ||
    previous.chainId !== next.chainId ||
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

export const isSameAddChainComparableMetadata = (previous: ChainMetadata, next: ChainMetadata) => {
  return isSameChainMetadata(normalizeAddChainComparableMetadata(previous), normalizeAddChainComparableMetadata(next));
};
