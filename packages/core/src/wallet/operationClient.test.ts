import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { WalletOperationHandlerTree } from "./executor.js";
import { defineWalletOperation, type WalletOperations } from "./operation.js";
import { createWalletOperationClient } from "./operationClient.js";

describe("wallet operation client", () => {
  it("builds method slots from operation paths", async () => {
    const operations = {
      setup: {
        getStatus: defineWalletOperation<{ availability: "ready" }>()({ input: z.undefined() }),
      },
      sample: {
        echo: defineWalletOperation<string>()({ input: z.string() }),
      },
    } as const satisfies WalletOperations;
    const calls: Array<{ path: string; input: unknown }> = [];
    const client = createWalletOperationClient({
      operations,
      call: async (path, input) => {
        calls.push({ path, input });
        return `${path}:${String(input)}`;
      },
    });

    await expect(client.setup.getStatus()).resolves.toBe("setup.getStatus:undefined");
    await expect(client.sample.echo("hello")).resolves.toBe("sample.echo:hello");
    if (false) {
      // @ts-expect-error sample.echo requires a string input.
      client.sample.echo();
    }
    expect(calls).toEqual([
      { path: "setup.getStatus", input: undefined },
      { path: "sample.echo", input: "hello" },
    ]);
  });

  it("keeps handler results tied to operation result types", () => {
    const operations = {
      setup: {
        getStatus: defineWalletOperation<{ availability: "ready" }>()({ input: z.undefined() }),
      },
    } as const satisfies WalletOperations;

    const handlers = {
      setup: {
        getStatus: () => ({ availability: "ready" as const }),
      },
    } as const satisfies WalletOperationHandlerTree<undefined, typeof operations>;

    expect(handlers.setup.getStatus(undefined, undefined)).toEqual({ availability: "ready" });

    const invalidHandlers = {
      setup: {
        // @ts-expect-error return value must match the operation result type.
        getStatus: () => ({ availability: "empty" as const }),
      },
    } as const satisfies WalletOperationHandlerTree<undefined, typeof operations>;

    expect(invalidHandlers.setup.getStatus()).toEqual({ availability: "empty" });
  });
});
