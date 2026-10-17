import { describe, expect, it, vi } from "vitest";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import { HdKeyringAlreadyExistsError, KeySourceRequiresHdKeyringError } from "./errors.js";
import { Keyring } from "./Keyring.js";
import type { Bip39KeySourceRecord, HdKeyringRecord } from "./persistence.js";

const source: Bip39KeySourceRecord = {
  keySourceId: "source-1",
  type: "bip39",
  name: "Wallet 1",
  backupStatus: "pending",
  createdAt: 1,
};

const record: HdKeyringRecord = {
  hdKeyringId: "hd-keyring-1",
  keySourceId: "source-1",
  namespace: "eip155",
  nextDerivationIndex: 1,
  createdAt: 1,
};

describe("Keyring derivation constraints", () => {
  it("rejects an HD keyring with an existing source and namespace", () => {
    const keyring = new Keyring({
      mutations: createCoreMutationQueue({ commit: vi.fn() }),
      publishChanged: vi.fn(),
      bootstrap: {
        keySources: [source],
        hdKeyrings: [record],
      },
    });

    expect(() => keyring.prepareAddHdKeyring({ ...record, hdKeyringId: "hd-keyring-2" })).toThrow(
      HdKeyringAlreadyExistsError,
    );
  });

  it("does not remove the last HD keyring for a BIP39 source", () => {
    const keyring = new Keyring({
      mutations: createCoreMutationQueue({ commit: vi.fn() }),
      publishChanged: vi.fn(),
      bootstrap: { keySources: [source], hdKeyrings: [record] },
    });

    expect(() => keyring.prepareRemoveHdKeyring(record.hdKeyringId)).toThrow(KeySourceRequiresHdKeyringError);
  });
});
