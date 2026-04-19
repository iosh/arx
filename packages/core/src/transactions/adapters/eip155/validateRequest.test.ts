import { ArxReasons } from "@arx/errors";
import { describe, expect, it } from "vitest";
import { eip155AddressCodec } from "../../../chains/eip155/addressCodec.js";
import { ChainAddressCodecRegistry } from "../../../chains/registry.js";
import { createEip155RequestValidator } from "./validateRequest.js";

const chains = new ChainAddressCodecRegistry([eip155AddressCodec]);
const validateRequest = createEip155RequestValidator({ chains });

describe("eip155 validateRequest", () => {
  it("accepts requests without nonce or gas/fee fields", () => {
    expect(
      validateRequest({
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          value: "0x0",
          data: "0x",
        },
      }),
    ).toBeUndefined();
  });

  it("rejects mixed legacy and eip1559 fee fields", () => {
    try {
      validateRequest({
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          value: "0x0",
          data: "0x",
          gasPrice: "0x1",
          maxFeePerGas: "0x2",
        },
      });
      expect.unreachable("expected request validation to throw");
    } catch (error) {
      expect(error).toMatchObject({
        reason: ArxReasons.RpcInvalidParams,
        data: expect.objectContaining({ code: "transaction.prepare.fee_conflict" }),
      });
    }
  });

  it("rejects gas below the minimum network floor", () => {
    try {
      validateRequest({
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          value: "0x0",
          data: "0x",
          gas: "0x5207",
        },
      });
      expect.unreachable("expected request validation to throw");
    } catch (error) {
      expect(error).toMatchObject({
        reason: ArxReasons.RpcInvalidParams,
        data: expect.objectContaining({ code: "transaction.validation.gas_too_low" }),
      });
    }
  });
});
