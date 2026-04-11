import type { UiKeyringMeta } from "@arx/core/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
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
  component: AccountsPage,
});

function AccountsPage() {
  const router = useRouter();
  const { snapshot, isLoading, switchAccount, markBackedUp, deriveAccount, importPrivateKey, fetchKeyrings } =
    useUiSnapshot();
  const [pendingAccountKey, setPendingAccountKey] = useState<string | null>(null);
  const [accountErrorMessage, setAccountErrorMessage] = useState<string | null>(null);
  const [markingKeyringId, setMarkingKeyringId] = useState<string | null>(null);
  const [backupErrorMessage, setBackupErrorMessage] = useState<string | null>(null);

  const [deriveOpen, setDeriveOpen] = useState(false);
  const [deriving, setDeriving] = useState(false);
  const [deriveErrorMessage, setDeriveErrorMessage] = useState<string | null>(null);
  const [hdKeyrings, setHdKeyrings] = useState<UiKeyringMeta[]>([]);
  const [selectedHdKeyringId, setSelectedHdKeyringId] = useState<string | null>(null);
  const [loadingHdKeyrings, setLoadingHdKeyrings] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importErrorMessage, setImportErrorMessage] = useState<string | null>(null);
  const [privateKeyValue, setPrivateKeyValue] = useState("");
  const [importAlias, setImportAlias] = useState("");

  const importPrivateKeyValid = isValidPrivateKey(privateKeyValue);
  const importValidationErrorMessage =
    !importErrorMessage && privateKeyValue.trim().length > 0 && !importPrivateKeyValid
      ? "Invalid private key (32-byte hex, 64 characters)."
      : undefined;

  const closeDeriveSheet = () => {
    setDeriveErrorMessage(null);
    setDeriveOpen(false);
  };

  const closeImportSheet = () => {
    setImportErrorMessage(null);
    setPrivateKeyValue("");
    setImportAlias("");
    setImportOpen(false);
  };

  useEffect(() => {
    if (!deriveOpen) return;
    let cancelled = false;

    setLoadingHdKeyrings(true);
    setDeriveErrorMessage(null);

    void fetchKeyrings()
      .then((keyrings) => {
        if (cancelled) return;
        const nextHdKeyrings = keyrings.filter((keyring) => keyring.type === "hd");
        setHdKeyrings(nextHdKeyrings);
        setSelectedHdKeyringId((current) => {
          if (current && nextHdKeyrings.some((keyring) => keyring.id === current)) return current;
          return nextHdKeyrings[0]?.id ?? null;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("[AccountsPage] failed to load keyrings", error);
        setDeriveErrorMessage(getErrorMessage(error));
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

  const handleAccountSwitch = async (accountKey: string | null) => {
    if (pendingAccountKey) return;

    setAccountErrorMessage(null);
    setPendingAccountKey(accountKey);

    try {
      await switchAccount({ chainRef: snapshot.chain.chainRef, accountKey });
      router.navigate({ to: ROUTES.HOME });
    } catch (error) {
      setAccountErrorMessage(getErrorMessage(error));
    } finally {
      setPendingAccountKey(null);
    }
  };

  const handleMarkBackedUp = async (keyringId: string) => {
    setMarkingKeyringId(keyringId);
    setBackupErrorMessage(null);

    try {
      await markBackedUp(keyringId);
    } catch (error) {
      setBackupErrorMessage(getErrorMessage(error));
    } finally {
      setMarkingKeyringId((current) => (current === keyringId ? null : current));
    }
  };

  const handleDeriveAccount = async () => {
    if (!snapshot.session.isUnlocked) {
      pushToast({ kind: "error", message: "Wallet is locked. Please unlock first.", dedupeKey: "derive-locked" });
      return;
    }

    if (!selectedHdKeyringId) {
      setDeriveErrorMessage("No HD wallet found. Create or import a recovery phrase wallet first.");
      return;
    }

    setDeriving(true);
    setDeriveErrorMessage(null);

    try {
      await deriveAccount({ keyringId: selectedHdKeyringId });
      pushToast({ kind: "success", message: "New account derived", dedupeKey: "derive-success" });
      closeDeriveSheet();
    } catch (error) {
      console.warn("[AccountsPage] failed to derive account", error);
      setDeriveErrorMessage(getErrorMessage(error));
    } finally {
      setDeriving(false);
    }
  };

  const handleImportPrivateKey = async () => {
    if (!snapshot.session.isUnlocked) {
      pushToast({ kind: "error", message: "Wallet is locked. Please unlock first.", dedupeKey: "import-pk-locked" });
      return;
    }

    const formattedPrivateKey = formatPrivateKeyHex(privateKeyValue);
    if (!formattedPrivateKey) {
      setImportErrorMessage("Enter a private key");
      return;
    }

    if (!isValidPrivateKey(formattedPrivateKey)) {
      setImportErrorMessage("Invalid private key format. Expected 64 hex characters (optionally prefixed with 0x).");
      return;
    }

    setImporting(true);
    setImportErrorMessage(null);

    try {
      const alias = importAlias.trim() || undefined;
      const result = await importPrivateKey({
        privateKey: formattedPrivateKey,
        alias,
        namespace: snapshot.chain.namespace,
      });
      pushToast({
        kind: "success",
        message: `Imported account ${result.account.address.slice(0, 6)}...${result.account.address.slice(-4)}`,
        dedupeKey: `import-pk-success:${result.account.address}`,
      });
      closeImportSheet();
    } catch (error) {
      console.warn("[AccountsPage] failed to import private key", error);
      setImportErrorMessage(getErrorMessage(error));
    } finally {
      setImporting(false);
    }
  };

  const nextHdKeyring = snapshot.backup.nextHdKeyring;

  return (
    <Screen>
      {nextHdKeyring ? (
        <Card padded bordered backgroundColor="$yellow2" gap="$2">
          <Paragraph fontWeight="600">Backup reminders</Paragraph>
          <XStack alignItems="center" justifyContent="space-between" gap="$2">
            <Paragraph>{nextHdKeyring.alias ?? "HD keyring"} needs backup</Paragraph>
            <Button
              size="$2"
              loading={markingKeyringId === nextHdKeyring.keyringId}
              onPress={() => void handleMarkBackedUp(nextHdKeyring.keyringId)}
            >
              Mark backed up
            </Button>
          </XStack>
          {snapshot.backup.pendingHdKeyringCount > 1 ? (
            <Paragraph color="$color10" fontSize="$2">
              {snapshot.backup.pendingHdKeyringCount} HD wallets still need backup.
            </Paragraph>
          ) : null}
          {backupErrorMessage ? (
            <Paragraph color="$red10" fontSize="$2">
              {backupErrorMessage}
            </Paragraph>
          ) : null}
        </Card>
      ) : null}

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
          snapshot.accounts.list.map((account) => {
            const isActive = snapshot.accounts.active?.accountKey === account.accountKey;
            const loading = pendingAccountKey === account.accountKey;

            return (
              <Card key={account.accountKey} padded bordered borderColor={isActive ? "$accent" : "$border"} gap="$2">
                <AddressDisplay address={account.canonicalAddress} displayAddress={account.displayAddress} />
                <XStack alignItems="center" justifyContent="space-between">
                  <Paragraph color={isActive ? "$accent" : "$mutedText"} fontSize="$2">
                    {isActive ? "Active" : "Available"}
                  </Paragraph>
                  <Button
                    size="$3"
                    disabled={isActive || loading}
                    onPress={() => void handleAccountSwitch(account.accountKey)}
                  >
                    {loading ? "Switching..." : isActive ? "Current" : "Switch"}
                  </Button>
                </XStack>
              </Card>
            );
          })
        )}

        {accountErrorMessage ? (
          <Paragraph color="$red10" fontSize="$2">
            {accountErrorMessage}
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
          setDeriveErrorMessage(null);
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
              const derivedCount = keyring.derivedCount ?? 0;

              return (
                <ListItem
                  key={keyring.id}
                  title={keyring.alias ?? "HD wallet"}
                  subtitle={`Next derivation index: ${derivedCount}`}
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

        {deriveErrorMessage ? (
          <Paragraph color="$danger" fontSize="$2">
            {deriveErrorMessage}
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
            setImportErrorMessage(null);
            setPrivateKeyValue("");
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
            value={privateKeyValue}
            onChangeText={(value) => {
              setPrivateKeyValue(value);
              if (importErrorMessage) setImportErrorMessage(null);
            }}
            placeholder="0x..."
            autoCapitalize="none"
            autoCorrect={false}
            errorText={importValidationErrorMessage}
            disabled={importing}
          />

          <TextField
            label="Account label (optional)"
            value={importAlias}
            onChangeText={setImportAlias}
            placeholder="e.g. Trading"
            disabled={importing}
          />

          {importErrorMessage ? (
            <Paragraph color="$danger" fontSize="$2">
              {importErrorMessage}
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
            disabled={importing || !importPrivateKeyValid}
            onPress={() => void handleImportPrivateKey()}
          >
            Import
          </Button>
        </XStack>
      </Sheet>
    </Screen>
  );
}
