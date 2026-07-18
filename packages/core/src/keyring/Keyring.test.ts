import { describe, expect, it } from "vitest";
import { loadKeyringBootstrap } from "./bootstrap.js";
import {
  HdKeyringAlreadyExistsError,
  HdKeyringNotFoundError,
  HdKeyringRequiresBip39SourceError,
  KeySourceNotFoundError,
  KeySourceRequiresHdKeyringError,
} from "./errors.js";
import { Keyring } from "./Keyring.js";
import type { Bip39KeySourceRecord, HdKeyringRecord, PrivateKeySourceRecord } from "./persistence.js";

const bip39Source = (keySourceId = "source-1"): Bip39KeySourceRecord => ({
  keySourceId,
  type: "bip39",
  backupStatus: "pending",
  createdAt: 1,
});

const privateKeySource = (keySourceId = "private-source"): PrivateKeySourceRecord => ({
  keySourceId,
  type: "private-key",
  namespace: "eip155",
  createdAt: 1,
});

const hdKeyring = (params: Partial<HdKeyringRecord> = {}): HdKeyringRecord => ({
  hdKeyringId: "hd-keyring-1",
  keySourceId: "source-1",
  namespace: "eip155",
  derivationProfileId: "bip44",
  nextDerivationIndex: 1,
  createdAt: 1,
  ...params,
});

describe("Keyring records", () => {
  it("loads all records once for runtime construction", async () => {
    const source = bip39Source();
    const keyring = hdKeyring();

    await expect(
      loadKeyringBootstrap({
        keySources: { listAll: async () => [source] },
        hdKeyrings: { listAll: async () => [keyring] },
      }),
    ).resolves.toEqual({ keySources: [source], hdKeyrings: [keyring] });
  });

  it("serves stable record reads from memory", () => {
    const keyring = new Keyring({
      keySources: [privateKeySource("source-b"), privateKeySource("source-a")],
      hdKeyrings: [],
    });

    expect(keyring.getKeySource("source-a")).toMatchObject({ keySourceId: "source-a" });
    expect(keyring.listKeySources().map((source) => source.keySourceId)).toEqual(["source-a", "source-b"]);
  });

  it("requires an existing BIP39 source when adding an HD keyring", () => {
    expect(() => new Keyring().prepareAddHdKeyring(hdKeyring())).toThrow(KeySourceNotFoundError);

    const keyring = new Keyring({ keySources: [privateKeySource("source-1")], hdKeyrings: [] });
    expect(() => keyring.prepareAddHdKeyring(hdKeyring())).toThrow(HdKeyringRequiresBip39SourceError);
  });

  it("rejects an HD keyring with an existing source, namespace, and profile combination", () => {
    const keyring = new Keyring({
      keySources: [bip39Source()],
      hdKeyrings: [hdKeyring()],
    });

    expect(() => keyring.prepareAddHdKeyring(hdKeyring({ hdKeyringId: "hd-keyring-2" }))).toThrow(
      HdKeyringAlreadyExistsError,
    );
  });

  it("prepares record changes without activating them before commit", () => {
    const keyring = new Keyring();
    const source = bip39Source();
    const keyringRecord = hdKeyring();

    const update = keyring.prepareAddBip39Source({ source, hdKeyring: keyringRecord });

    expect(keyring.getKeySource(source.keySourceId)).toBeNull();
    expect(update.persistenceChanges.map((change) => change.persistenceType)).toEqual(["keySource", "hdKeyring"]);

    keyring.applyCommittedUpdate(update);
    expect(keyring.getKeySource(source.keySourceId)).toEqual(source);
    expect(keyring.getHdKeyring(keyringRecord.hdKeyringId)).toEqual(keyringRecord);
  });

  it("advances the derivation cursor through an explicit record change", () => {
    const record = hdKeyring();
    const keyring = new Keyring({ keySources: [bip39Source()], hdKeyrings: [record] });

    const update = keyring.prepareAdvanceHdKeyring(record.hdKeyringId);
    expect(keyring.getHdKeyring(record.hdKeyringId)?.nextDerivationIndex).toBe(1);

    keyring.applyCommittedUpdate(update);
    expect(keyring.getHdKeyring(record.hdKeyringId)?.nextDerivationIndex).toBe(2);
  });

  it("does not remove the last HD keyring for a BIP39 source", () => {
    const record = hdKeyring();
    const keyring = new Keyring({ keySources: [bip39Source()], hdKeyrings: [record] });

    expect(() => keyring.prepareRemoveHdKeyring(record.hdKeyringId)).toThrow(KeySourceRequiresHdKeyringError);
    expect(() => keyring.prepareRemoveHdKeyring("missing")).toThrow(HdKeyringNotFoundError);
  });
});
