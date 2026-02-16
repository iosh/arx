import { z } from "zod";
import { type ParsedChainRef, parseChainRef } from "./caip.js";
import type { ChainRef } from "./ids.js";
import { HTTP_PROTOCOLS, isUrlWithProtocols, RPC_PROTOCOLS } from "./url.js";

export type ChainFeature = string;

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

export interface RpcEndpoint {
  url: string;
  type?: "public" | "authenticated" | "private" | undefined;
  weight?: number | undefined;
  headers?: Record<string, string> | undefined;
}

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface ChainMetadata {
  chainRef: ChainRef;
  namespace: string;
  chainId: string;
  displayName: string;
  shortName?: string | undefined;
  description?: string | undefined;
  nativeCurrency: NativeCurrency;
  rpcEndpoints: readonly RpcEndpoint[];
  blockExplorers?: readonly ExplorerLink[] | undefined;
  icon?: ChainIcon | undefined;
  features?: readonly ChainFeature[] | undefined;
  tags?: readonly string[] | undefined;
  extensions?: Record<string, unknown> | undefined;
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

const httpUrlSchema = z.url().refine((value) => isUrlWithProtocols(value, HTTP_PROTOCOLS), {
  message: "URL must use the http or https protocol",
});

const rpcUrlSchema = z.url().refine((value) => isUrlWithProtocols(value, RPC_PROTOCOLS), {
  message: "URL must use http, https, ws, or wss protocol",
});

const chainIdSchema = z
  .string({ error: "Chain metadata must include chainId" })
  .min(1)
  .refine((value) => value.trim() === value, { message: "Value must not include leading or trailing whitespace" });

const nativeCurrencySchema: z.ZodType<NativeCurrency> = z.strictObject({
  name: trimmedString(),
  symbol: trimmedString(),
  decimals: z.number().int().min(0),
});

export const rpcEndpointSchema: z.ZodType<RpcEndpoint> = z.strictObject({
  url: rpcUrlSchema,
  type: z.enum(["public", "authenticated", "private"]).optional(),
  weight: z.number().positive().optional(),
  headers: z.record(trimmedString(), z.string()).optional(),
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

const createDuplicateChecker =
  (label: string, path: (string | number)[]) => (values: readonly string[] | undefined, ctx: z.RefinementCtx) => {
    if (!values) {
      return;
    }
    const set = new Set<string>();
    for (const value of values) {
      if (set.has(value)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate ${label}: ${value}`,
          path,
        });
      }
      set.add(value);
    }
  };

const baseSchema: z.ZodType<ChainMetadata> = z.strictObject({
  chainRef: trimmedString(),
  namespace: trimmedString(),
  chainId: chainIdSchema,
  displayName: trimmedString(),
  shortName: trimmedString().optional(),
  description: trimmedString().optional(),
  nativeCurrency: nativeCurrencySchema,
  rpcEndpoints: z.array(rpcEndpointSchema).min(1),
  blockExplorers: z.array(explorerLinkSchema).optional(),
  icon: chainIconSchema.optional(),
  features: z.array(trimmedString()).optional(),
  tags: z.array(trimmedString()).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

const defaultNamespaceValidators: Record<string, NamespaceMetadataValidator> = {
  eip155: ({ metadata, parsed, ctx }) => {
    const hex = metadata.chainId?.toLowerCase();
    if (!hex || !/^0x[0-9a-f]+$/.test(hex)) {
      ctx.addIssue({
        code: "custom",
        message: "EIP-155 metadata must include a hex chainId",
        path: ["chainId"],
      });
      return;
    }
    try {
      const decimal = BigInt(hex).toString(10);
      if (decimal !== parsed.reference) {
        ctx.addIssue({
          code: "custom",
          message: `chainId (${metadata.chainId}) does not match CAIP-2 reference (${parsed.reference})`,
          path: ["chainId"],
        });
      }
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "chainId could not be parsed as a number",
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

    const rpcUrls = new Set<string>();
    for (const endpoint of value.rpcEndpoints) {
      if (rpcUrls.has(endpoint.url)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate RPC endpoint URL: ${endpoint.url}`,
          path: ["rpcEndpoints"],
        });
      }
      rpcUrls.add(endpoint.url);
    }

    createDuplicateChecker("feature", ["features"])(value.features, ctx);
    createDuplicateChecker("tag", ["tags"])(value.tags, ctx);

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
