import { secp256k1 } from "@noble/curves/secp256k1.js";
import * as Hash from "ox/Hash";
import * as Hex from "ox/Hex";
import { describe, expect, it } from "vitest";
import { toAccountIdFromAddress } from "../../../accounts/accountId.js";
import type { TransactionAdapterContext } from "../types.js";
import { createEip155Signer } from "./signer.js";

const toQuantity = (value: bigint) => `0x${value === 0n ? "0" : value.toString(16)}` as const;

describe("eip155 signer (vectors)", () => {
  it("signPersonalMessage vector (raw bytes)", async () => {
    const privateKey = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
    const address = "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c" as const;
    const chainRef = "eip155:1" as const;
    const accountId = toAccountIdFromAddress({ chainRef, address });
    const secret = Hex.toBytes(privateKey);

    const keyring = {
      waitForReady: async () => {},
      hasAccountId: (id: string) => id === accountId,
      signDigestByAccountId: async ({ accountId: id, digest }: { accountId: string; digest: Uint8Array }) => {
        expect(id).toBe(accountId);
        const sig = secp256k1.sign(digest, secret, { lowS: true });
        return { r: sig.r, s: sig.s, yParity: sig.recovery, bytes: sig.toCompactRawBytes() };
      },
    };

    const signer = createEip155Signer({ keyring });

    const message = "0x68656c6c6f20776f726c64" as const; // "hello world"
    const signature = await signer.signPersonalMessage({ accountId, message });

    // Precomputed with viem@2.39.0 (privateKeyToAccount(privateKey).signMessage({ message: { raw: message } }))
    expect(signature.toLowerCase()).toBe(
      "0x82fb0e34cfc3ea50229b71b6740c0dccf9c2e89b7eb7ae6a9aad222413e915c2076add03b24d41e5099dad140db29beee025311df17ef26f0145da89f33795001b",
    );
  });

  it("signTypedData vector", async () => {
    const privateKey = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
    const address = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A" as const;
    const chainRef = "eip155:1" as const;
    const accountId = toAccountIdFromAddress({ chainRef, address });
    const secret = Hex.toBytes(privateKey);

    const keyring = {
      waitForReady: async () => {},
      hasAccountId: (id: string) => id === accountId,
      signDigestByAccountId: async ({ accountId: id, digest }: { accountId: string; digest: Uint8Array }) => {
        expect(id).toBe(accountId);
        const sig = secp256k1.sign(digest, secret, { lowS: true });
        return { r: sig.r, s: sig.s, yParity: sig.recovery, bytes: sig.toCompactRawBytes() };
      },
    };

    const signer = createEip155Signer({ keyring });

    const typedData = {
      domain: {
        name: "ARX",
        version: "1",
        chainId: 1,
        verifyingContract: "0x0000000000000000000000000000000000000000",
      },
      types: {
        Person: [
          { name: "name", type: "string" },
          { name: "wallet", type: "address" },
        ],
        Mail: [
          { name: "from", type: "Person" },
          { name: "to", type: "Person" },
          { name: "contents", type: "string" },
        ],
      },
      primaryType: "Mail",
      message: {
        from: { name: "Alice", wallet: address },
        to: { name: "Bob", wallet: "0x0000000000000000000000000000000000000001" },
        contents: "Hello, Bob!",
      },
    } as const;

    const signature = await signer.signTypedData({ accountId, typedData: JSON.stringify(typedData) });

    // Precomputed with viem@2.39.0 (privateKeyToAccount(privateKey).signTypedData(typedData))
    expect(signature.toLowerCase()).toBe(
      "0x99f7bc1f0b9803996bd52c0c658556f6a1353d000eb29c198cb89dc9e920500340f12724419be83cbf28762907f9da7657105697db71824362d20a8df05c8cf51c",
    );
  });

  it("signTransaction vector (eip1559)", async () => {
    const privateKey = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
    const address = "0x8fd379246834eac74B8419FfdA202CF8051F7A03" as const;
    const chainRef = "eip155:1" as const;
    const accountId = toAccountIdFromAddress({ chainRef, address });
    const secret = Hex.toBytes(privateKey);

    const keyring = {
      waitForReady: async () => {},
      hasAccountId: (id: string) => id === accountId,
      signDigestByAccountId: async ({ accountId: id, digest }: { accountId: string; digest: Uint8Array }) => {
        expect(id).toBe(accountId);
        const sig = secp256k1.sign(digest, secret, { lowS: true });
        return { r: sig.r, s: sig.s, yParity: sig.recovery, bytes: sig.toCompactRawBytes() };
      },
    };

    const signer = createEip155Signer({ keyring });

    const to = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as const;
    const context: TransactionAdapterContext = {
      namespace: "eip155",
      chainRef,
      origin: "https://example.test",
      from: address,
      request: {} as unknown as TransactionAdapterContext["request"],
      meta: { from: address } as unknown as TransactionAdapterContext["meta"],
    };
    const signed = await signer.signTransaction(context, {
      chainId: toQuantity(1n),
      nonce: toQuantity(0n),
      gas: toQuantity(21_000n),
      maxFeePerGas: toQuantity(1_000_000_000n),
      maxPriorityFeePerGas: toQuantity(1_000_000_000n),
      to,
      value: toQuantity(1_000_000_000_000_000_000n),
    });

    // Precomputed with viem@2.39.0 (privateKeyToAccount(privateKey).signTransaction(...))
    expect(signed.raw.toLowerCase()).toBe(
      "0x02f8720180843b9aca00843b9aca008252089470997970c51812dc3a010c7d01b50e0d17dc79c8880de0b6b3a764000080c080a0182c8cbe9c63b8447c2f953085570b33023f5eef5f11ea48cb919909b619095ea040c65acd60b3c054ac73d5314a4befdc7a64bae3c7819e3079c6237ef5951f2e",
    );
    expect(signed.hash?.toLowerCase()).toBe("0xb97fef798c937bdfdd97763637a3c846a0e2054db0d31d792d6f1327c386a41e");
    expect(Hash.keccak256(signed.raw as `0x${string}`).toLowerCase()).toBe(signed.hash?.toLowerCase());
  });

  it("signTransaction vector (legacy)", async () => {
    const privateKey = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
    const address = "0x88f9B82462f6C4bf4a0Fb15e5c3971559a316e7f" as const;
    const chainRef = "eip155:1" as const;
    const accountId = toAccountIdFromAddress({ chainRef, address });
    const secret = Hex.toBytes(privateKey);

    const keyring = {
      waitForReady: async () => {},
      hasAccountId: (id: string) => id === accountId,
      signDigestByAccountId: async ({ accountId: id, digest }: { accountId: string; digest: Uint8Array }) => {
        expect(id).toBe(accountId);
        const sig = secp256k1.sign(digest, secret, { lowS: true });
        return { r: sig.r, s: sig.s, yParity: sig.recovery, bytes: sig.toCompactRawBytes() };
      },
    };

    const signer = createEip155Signer({ keyring });

    const to = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as const;
    const context: TransactionAdapterContext = {
      namespace: "eip155",
      chainRef,
      origin: "https://example.test",
      from: address,
      request: {} as unknown as TransactionAdapterContext["request"],
      meta: { from: address } as unknown as TransactionAdapterContext["meta"],
    };
    const signed = await signer.signTransaction(context, {
      chainId: toQuantity(1n),
      nonce: toQuantity(0n),
      gas: toQuantity(21_000n),
      gasPrice: toQuantity(1_000_000_000n),
      to,
      value: toQuantity(123n),
    });

    // Precomputed with viem@2.39.0 (privateKeyToAccount(privateKey).signTransaction(...))
    expect(signed.raw.toLowerCase()).toBe(
      "0xf86380843b9aca008252089470997970c51812dc3a010c7d01b50e0d17dc79c87b8026a01d486b7b5b2147302c828c070b2027d1475eb4e7024a54722dcf2dacb5433c76a03b612ded9618360d7036737707d61e53103b32472df1de405feb7dcbf5f85f9a",
    );
    expect(signed.hash?.toLowerCase()).toBe("0x29f871475978dfb2d00e07c7a634fcc5cbe748ed2189f163af691305b04d9f5d");
    expect(Hash.keccak256(signed.raw as `0x${string}`).toLowerCase()).toBe(signed.hash?.toLowerCase());
  });
});
