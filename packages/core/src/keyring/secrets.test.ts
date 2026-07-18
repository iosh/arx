import { describe, expect, it } from "vitest";
import { createKeyringSecrets, decodeKeyringSecrets, encodeKeyringSecrets } from "./secrets.js";

describe("keyring secrets codec", () => {
  it("roundtrips BIP39 and private-key secrets without non-secret record fields", () => {
    const secrets = createKeyringSecrets([
      {
        keySourceId: "source-bip39",
        type: "bip39",
        mnemonic: "test mnemonic",
      },
      {
        keySourceId: "source-private-key",
        type: "private-key",
        privateKey: "private-key",
      },
    ]);

    expect(decodeKeyringSecrets(encodeKeyringSecrets(secrets))).toEqual(secrets);
    expect(JSON.parse(new TextDecoder().decode(encodeKeyringSecrets(secrets)))).toEqual({
      keySources: secrets.keySources,
    });
  });
});
