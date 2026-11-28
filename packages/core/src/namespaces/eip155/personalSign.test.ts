import { expect, it } from "vitest";
import { decodePersonalSignParams, personalMessageDigest } from "./personalSign.js";

it("preserves personal-sign bytes and reversed parameter order", () => {
  const address = "0xfcad0b19bb29d4674531d6f115237e16afce377c";
  const inputAddress = address.slice(2).toUpperCase();
  // EIP-191 vectors for UTF-8 hello and the two bytes 12 34.
  const cases = [
    {
      input: "hello",
      message: { format: "utf8", value: "hello" },
      digest: "0x50b2c43fd39106bafbba0da34fc430e1f91e3c96ea2acee2bc34119f92b37750",
    },
    ...["0x1234", "0X1234", "1234"].map((input) => ({
      input,
      message: { format: "hex", value: "0x1234" },
      digest: "0x456d81ecedeaa272a18e100870c4def2ef78a70e3e077ba40e0a92114b5865c5",
    })),
  ] as const;
  for (const example of cases) {
    for (const params of [
      [example.input, inputAddress],
      [inputAddress, example.input],
    ]) {
      const decoded = decodePersonalSignParams(params, "personal_sign");
      expect(decoded).toEqual({ address, message: example.message });
      expect(personalMessageDigest(decoded.message)).toBe(example.digest);
    }
  }

  const messageBytes = "1111111111111111111111111111111111111111";
  expect(decodePersonalSignParams([inputAddress, `0X${messageBytes}`], "personal_sign")).toEqual({
    address,
    message: { format: "hex", value: `0x${messageBytes}` },
  });

  expect(() => decodePersonalSignParams(["hello", ` ${address} `], "personal_sign")).toThrow(
    "valid EIP-155 account address",
  );
});
