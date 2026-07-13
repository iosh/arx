import { describe, expect, it, vi } from "vitest";
import { createPrepareContext } from "./__fixtures__/contexts.js";
import { createTestPrepareTransaction, requireReadyPrepared } from "./__fixtures__/prepareTransaction.js";

describe("prepareTransaction - fees", () => {
  it("uses a provided legacy gas price without consulting the fee oracle", async () => {
    const feeOracle = { suggestFees: vi.fn() };
    const prepareTransaction = createTestPrepareTransaction({
      feeOracleFactory: vi.fn(() => feeOracle),
    });
    const ctx = createPrepareContext();
    ctx.request.payload.gasPrice = "0x3b9aca00";

    const prepared = requireReadyPrepared(await prepareTransaction(ctx));

    expect(prepared.gasPrice).toBe("0x3b9aca00");
    expect(feeOracle.suggestFees).not.toHaveBeenCalled();
  });

  it("uses legacy fee data returned by the fee oracle", async () => {
    const feeOracle = {
      suggestFees: vi.fn(async () => ({
        mode: "legacy" as const,
        gasPrice: "0x3b9aca00" as const,
        source: "eth_gasPrice" as const,
      })),
    };
    const prepareTransaction = createTestPrepareTransaction({
      feeOracleFactory: vi.fn(() => feeOracle),
    });
    const ctx = createPrepareContext();
    Reflect.deleteProperty(ctx.request.payload, "gasPrice");
    Reflect.deleteProperty(ctx.request.payload, "maxFeePerGas");
    Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");

    const prepared = requireReadyPrepared(await prepareTransaction(ctx));

    expect(prepared.gasPrice).toBe("0x3b9aca00");
  });

  it("normalizes provided EIP-1559 fee fields", async () => {
    const prepareTransaction = createTestPrepareTransaction();
    const ctx = createPrepareContext();
    Reflect.deleteProperty(ctx.request.payload, "gasPrice");
    ctx.request.payload.maxFeePerGas = "0x59682F00";
    ctx.request.payload.maxPriorityFeePerGas = "0x3B9ACA00";

    const prepared = requireReadyPrepared(await prepareTransaction(ctx));

    expect(prepared.maxFeePerGas).toBe("0x59682f00");
    expect(prepared.maxPriorityFeePerGas).toBe("0x3b9aca00");
  });

  it("allows an incomplete EIP-1559 fee pair during preparation", async () => {
    const prepareTransaction = createTestPrepareTransaction();
    const ctx = createPrepareContext();
    ctx.request.payload.maxFeePerGas = "0x59682f00";
    Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");

    await expect(prepareTransaction(ctx)).resolves.toMatchObject({ status: "ready" });
  });

  it("does not reject mixed legacy and EIP-1559 fee fields during preparation", async () => {
    const prepareTransaction = createTestPrepareTransaction();
    const ctx = createPrepareContext();
    ctx.request.payload.gasPrice = "0x3b9aca00";
    ctx.request.payload.maxFeePerGas = "0x59682f00";
    ctx.request.payload.maxPriorityFeePerGas = "0x3b9aca00";

    await expect(prepareTransaction(ctx)).resolves.toMatchObject({ status: "ready" });
  });

  it("returns the fee estimation failure", async () => {
    const feeOracle = { suggestFees: vi.fn().mockRejectedValue(new Error("fee rpc down")) };
    const prepareTransaction = createTestPrepareTransaction({
      feeOracleFactory: vi.fn(() => feeOracle),
    });
    const ctx = createPrepareContext();
    Reflect.deleteProperty(ctx.request.payload, "gasPrice");
    Reflect.deleteProperty(ctx.request.payload, "maxFeePerGas");
    Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");

    const result = await prepareTransaction(ctx);

    expect(result).toMatchObject({
      status: "failed",
      error: {
        code: "transaction.prepare.fee_estimation_failed",
        details: { method: "feeOracle.suggestFees", error: "fee rpc down" },
      },
    });
  });
});
