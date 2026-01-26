import type { UiKeyringMeta } from "@arx/core/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Paragraph, XStack, YStack } from "tamagui";
import {
  AddressDisplay,
  Button,
  Card,
  ChainBadge,
  Divider,
  ListItem,
  LoadingScreen,
  PasswordInput,
  Screen,
  Sheet,
  TextField,
} from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { formatPrivateKeyHex, isValidPrivateKey } from "@/ui/lib/privateKeyInput";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { pushToast } from "@/ui/lib/toast";

export const Route = createFileRoute("/accounts")({
  beforeLoad: requireVaultInitialized,
  component: AccountSwitchPage,
});

function AccountSwitchPage() {
  const router = useRouter();
  const { snapshot, isLoading, switchAccount, markBackedUp, deriveAccount, importPrivateKey, fetchKeyrings } =
    useUiSnapshot();
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const [backupError, setBackupError] = useState<string | null>(null);
  const backupWarnings = useMemo(
    () => snapshot?.warnings.hdKeyringsNeedingBackup ?? [],
    [snapshot?.warnings.hdKeyringsNeedingBackup],
  );

  const [deriveOpen, setDeriveOpen] = useState(false);
  const [deriving, setDeriving] = useState(false);
  const [deriveError, setDeriveError] = useState<string | null>(null);
  const [hdKeyrings, setHdKeyrings] = useState<UiKeyringMeta[]>([]);
  const [selectedHdKeyringId, setSelectedHdKeyringId] = useState<string | null>(null);
  const [loadingHdKeyrings, setLoadingHdKeyrings] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPrivateKeyValue, setImportPrivateKeyValue] = useState("");
  const [importAlias, setImportAlias] = useState("");

  const importPkValid = isValidPrivateKey(importPrivateKeyValue);
  const importValidationError =
    !importError && importPrivateKeyValue.trim().length > 0 && !importPkValid
      ? "Invalid private key (32-byte hex, 64 characters)."
      : undefined;

  const closeDeriveSheet = () => {
    setDeriveError(null);
    setDeriveOpen(false);
  };

  const closeImportSheet = () => {
    setImportError(null);
    setImportPrivateKeyValue("");
    setImportAlias("");
    setImportOpen(false);
  };

  useEffect(() => {
    if (!deriveOpen) return;
    let cancelled = false;

    setLoadingHdKeyrings(true);
    setDeriveError(null);

    void fetchKeyrings()
      .then((keyrings) => {
        if (cancelled) return;
        const hd = keyrings.filter((k) => k.type === "hd");
        setHdKeyrings(hd);
        setSelectedHdKeyringId((current) => {
          if (current && hd.some((k) => k.id === current)) return current;
          return hd[0]?.id ?? null;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("[AccountSwitchPage] failed to load keyrings", error);
        setDeriveError(getErrorMessage(error));
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingHdKeyrings(false);
      });

    return () => {
      cancelled = true;
    };
  }, [deriveOpen, fetchKeyrings]);

  if (isLoading || !snapshot) {
    return <LoadingScreen />;
  }

  const handleAccountSwitch = async (address: string | null) => {
    if (pendingAddress) return;

    setErrorMessage(null);
    setPendingAddress(address);
    try {
      await switchAccount({ chainRef: snapshot.chain.chainRef, address });
      router.navigate({ to: ROUTES.HOME });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPendingAddress(null);
    }
  };
  const handleMarkBackedUp = async (keyringId: string) => {
    setMarkingId(keyringId);
    setBackupError(null);
    try {
      await markBackedUp(keyringId);
    } catch (error) {
      setBackupError(getErrorMessage(error));
    } finally {
      setMarkingId((current) => (current === keyringId ? null : current));
    }
  };

  const handleDeriveAccount = async () => {
    if (!snapshot.session.isUnlocked) {
      pushToast({ kind: "error", message: "Wallet is locked. Please unlock first.", dedupeKey: "derive-locked" });
      return;
    }

    const keyringId = selectedHdKeyringId;
    if (!keyringId) {
      setDeriveError("No HD wallet found. Create or import a recovery phrase wallet first.");
      return;
    }

    setDeriving(true);
    setDeriveError(null);

    try {
      await deriveAccount({ keyringId });
      pushToast({ kind: "success", message: "New account derived", dedupeKey: "derive-success" });
      setDeriveOpen(false);
    } catch (error) {
      console.warn("[AccountSwitchPage] failed to derive account", error);
      setDeriveError(getErrorMessage(error));
    } finally {
      setDeriving(false);
    }
  };

  const handleImportPrivateKey = async () => {
    if (!snapshot.session.isUnlocked) {
      pushToast({ kind: "error", message: "Wallet is locked. Please unlock first.", dedupeKey: "import-pk-locked" });
      return;
    }

    const normalized = formatPrivateKeyHex(importPrivateKeyValue);
    if (!normalized) {
      setImportError("Enter a private key");
      return;
    }
    if (!isValidPrivateKey(normalized)) {
      setImportError("Invalid private key format. Expected 64 hex characters (optionally prefixed with 0x).");
      return;
    }

    setImporting(true);
    setImportError(null);

    try {
      const alias = importAlias.trim() || undefined;
      const res = await importPrivateKey({ privateKey: normalized, alias, namespace: snapshot.chain.namespace });
      pushToast({
        kind: "success",
        message: `Imported account ${res.account.address.slice(0, 6)}...${res.account.address.slice(-4)}`,
        dedupeKey: `import-pk-success:${res.account.address}`,
      });
      setImportPrivateKeyValue("");
      setImportAlias("");
      setImportOpen(false);
    } catch (error) {
      console.warn("[AccountSwitchPage] failed to import private key", error);
      setImportError(getErrorMessage(error));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Screen>
      {backupWarnings.length > 0 && (
        <Card padded bordered backgroundColor="$yellow2" gap="$2">
          <Paragraph fontWeight="600">Backup reminders</Paragraph>
          {backupWarnings.map((warning) => (
            <XStack key={warning.keyringId} alignItems="center" justifyContent="space-between" gap="$2">
              <Paragraph>{warning.alias ?? "HD keyring"} needs backup</Paragraph>
              <Button
                size="$2"
                loading={markingId === warning.keyringId}
                onPress={() => void handleMarkBackedUp(warning.keyringId)}
              >
                Mark backed up
              </Button>
            </XStack>
          ))}
          {backupError ? (
            <Paragraph color="$red10" fontSize="$2">
              {backupError}
            </Paragraph>
          ) : null}
        </Card>
      )}

      <Button onPress={() => router.navigate({ to: ROUTES.HOME })}>Back</Button>

      <Card padded bordered gap="$2">
        <Paragraph fontSize="$6" fontWeight="600">
          Accounts
        </Paragraph>
        <ChainBadge chainRef={snapshot.chain.chainRef} displayName={snapshot.chain.displayName} size="sm" />

        <Divider marginVertical="$2" />

        {snapshot.accounts.list.length === 0 ? (
          <Paragraph color="$color10">No accounts available yet.</Paragraph>
        ) : (
          snapshot.accounts.list.map((address) => {
            const isActive = snapshot.accounts.active === address;
            const loading = pendingAddress === address;
            return (
              <Card key={address} padded bordered borderColor={isActive ? "$accent" : "$border"} gap="$2">
                <AddressDisplay
                  address={address}
                  namespace={snapshot.chain.namespace}
                  chainRef={snapshot.chain.chainRef}
                />
                <XStack alignItems="center" justifyContent="space-between">
                  <Paragraph color={isActive ? "$accent" : "$mutedText"} fontSize="$2">
                    {isActive ? "Active" : "Available"}
                  </Paragraph>
                  <Button size="$3" disabled={isActive || loading} onPress={() => void handleAccountSwitch(address)}>
                    {loading ? "Switching..." : isActive ? "Current" : "Switch"}
                  </Button>
                </XStack>
              </Card>
            );
          })
        )}
        {errorMessage ? (
          <Paragraph color="$red10" fontSize="$2">
            {errorMessage}
          </Paragraph>
        ) : null}
      </Card>

      <Card padded bordered gap="$2">
        <Paragraph fontWeight="600">Account Management</Paragraph>

        <Paragraph color="$color10" fontSize="$2">
          Manage additional accounts (requires unlocked wallet).
        </Paragraph>

        <Button disabled={!snapshot.session.isUnlocked} onPress={() => setDeriveOpen(true)}>
          Derive New Account
        </Button>
        <Button disabled={!snapshot.session.isUnlocked} onPress={() => setImportOpen(true)}>
          Import Private Key
        </Button>
      </Card>

      <Sheet
        open={deriveOpen}
        title="Derive new account"
        dismissOnOverlayPress={false}
        onOpenChange={(open) => {
          if (!open && deriving) return;
          setDeriveError(null);
          setDeriveOpen(open);
        }}
      >
        <Paragraph color="$mutedText" fontSize="$2">
          This will derive the next account from your recovery phrase wallet.
        </Paragraph>

        {loadingHdKeyrings ? (
          <Paragraph color="$mutedText" fontSize="$2">
            Loading wallets...
          </Paragraph>
        ) : hdKeyrings.length > 1 ? (
          <YStack gap="$2">
            <Paragraph fontWeight="600">Choose wallet</Paragraph>
            {hdKeyrings.map((keyring) => {
              const selected = selectedHdKeyringId === keyring.id;
              const alias = keyring.alias ?? "HD wallet";
              const derivedCount = keyring.derivedCount ?? 0;
              return (
                <ListItem
                  key={keyring.id}
                  title={alias}
                  subtitle={`Derived accounts: ${derivedCount}`}
                  right={selected ? <Check size={18} /> : null}
                  onPress={deriving ? undefined : () => setSelectedHdKeyringId(keyring.id)}
                />
              );
            })}
          </YStack>
        ) : hdKeyrings.length === 1 ? (
          <Paragraph color="$mutedText" fontSize="$2">
            Wallet: {hdKeyrings[0]?.alias ?? "HD wallet"}
          </Paragraph>
        ) : null}

        {deriveError ? (
          <Paragraph color="$danger" fontSize="$2">
            {deriveError}
          </Paragraph>
        ) : null}

        <XStack gap="$2">
          <Button flex={1} variant="secondary" disabled={deriving} onPress={closeDeriveSheet}>
            Cancel
          </Button>
          <Button
            flex={1}
            variant="primary"
            loading={deriving || loadingHdKeyrings}
            disabled={deriving || loadingHdKeyrings || !selectedHdKeyringId}
            onPress={() => void handleDeriveAccount()}
          >
            Derive
          </Button>
        </XStack>
      </Sheet>

      <Sheet
        open={importOpen}
        title="Import private key"
        dismissOnOverlayPress={false}
        onOpenChange={(open) => {
          if (!open && importing) return;
          if (!open) {
            setImportError(null);
            setImportPrivateKeyValue("");
            setImportAlias("");
          }
          setImportOpen(open);
        }}
      >
        <YStack gap="$3">
          <Paragraph color="$mutedText" fontSize="$2">
            Paste a raw hex private key. Never share it with anyone.
          </Paragraph>

          <PasswordInput
            label="Private key"
            value={importPrivateKeyValue}
            onChangeText={(value) => {
              setImportPrivateKeyValue(value);
              if (importError) setImportError(null);
            }}
            placeholder="0x..."
            autoCapitalize="none"
            autoCorrect={false}
            errorText={importValidationError}
            disabled={importing}
          />

          <TextField
            label="Account label (optional)"
            value={importAlias}
            onChangeText={setImportAlias}
            placeholder="e.g. Trading"
            disabled={importing}
          />

          {importError ? (
            <Paragraph color="$danger" fontSize="$2">
              {importError}
            </Paragraph>
          ) : null}
        </YStack>

        <XStack gap="$2">
          <Button flex={1} variant="secondary" disabled={importing} onPress={closeImportSheet}>
            Cancel
          </Button>
          <Button
            flex={1}
            variant="primary"
            loading={importing}
            disabled={importing || !importPkValid}
            onPress={() => void handleImportPrivateKey()}
          >
            Import
          </Button>
        </XStack>
      </Sheet>
    </Screen>
  );
}
