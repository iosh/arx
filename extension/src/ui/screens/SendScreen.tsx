import type { UiSnapshot } from "@arx/core/ui";
import { ArrowUpRight } from "lucide-react";
import * as Value from "ox/Value";
import { useMemo, useState } from "react";
import { Paragraph, XStack, YStack } from "tamagui";
import { AddressDisplay, Button, ChainBadge, Screen, TextField } from "@/ui/components";

const EVM_ADDRESS_PATTERN = /^(?:0x)?[0-9a-fA-F]{40}$/i;

const normalizeEvmAddressInput = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) return trimmed;
  return `0x${trimmed}`;
};

type SendScreenProps = {
  snapshot: UiSnapshot;
  pending: boolean;
  errorMessage: string | null;
  onSubmit: (params: { to: string; valueEther: string }) => void;
  onCancel: () => void;
};

export function SendScreen({ snapshot, pending, errorMessage, onSubmit, onCancel }: SendScreenProps) {
  const { chain, accounts } = snapshot;
  const [to, setTo] = useState("");
  const [valueEther, setValueEther] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const errors = useMemo(() => {
    const normalizedTo = normalizeEvmAddressInput(to);
    const toError =
      normalizedTo.length === 0
        ? "Enter a recipient address"
        : EVM_ADDRESS_PATTERN.test(normalizedTo)
          ? null
          : "Invalid EVM address";

    const trimmedValue = valueEther.trim();
    let valueError: string | null = null;
    if (trimmedValue.length === 0) {
      valueError = "Enter an amount";
    } else {
      try {
        const wei = Value.fromEther(trimmedValue);
        if (wei <= 0n) valueError = "Amount must be greater than 0";
      } catch {
        valueError = "Invalid amount";
      }
    }

    return { normalizedTo, toError, valueError };
  }, [to, valueEther]);

  const canSubmit = !errors.toError && !errors.valueError && accounts.active && !pending;

  const handleSubmit = () => {
    setSubmitted(true);
    if (!accounts.active) return;
    if (errors.toError || errors.valueError) return;
    onSubmit({ to: errors.normalizedTo, valueEther: valueEther.trim() });
  };

  return (
    <Screen
      title="Send"
      subtitle={chain.displayName}
      footer={
        <XStack gap="$3">
          <Button flex={1} variant="secondary" onPress={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            flex={1}
            variant="primary"
            icon={<ArrowUpRight size={18} />}
            disabled={!canSubmit}
            loading={pending}
            onPress={handleSubmit}
          >
            Review
          </Button>
        </XStack>
      }
    >
      <YStack gap="$4">
        <XStack alignItems="center" justifyContent="space-between">
          <ChainBadge chainRef={chain.chainRef} displayName={chain.displayName} size="sm" showChainRef={false} />
          <Paragraph color="$mutedText" fontSize="$2">
            {chain.chainRef}
          </Paragraph>
        </XStack>

        <YStack gap="$1">
          <Paragraph color="$mutedText" fontSize="$2" fontWeight="600">
            From
          </Paragraph>
          {accounts.active ? (
            <AddressDisplay
              address={accounts.active}
              namespace={chain.namespace}
              chainRef={chain.chainRef}
              fontSize="$4"
              fontWeight="600"
            />
          ) : (
            <Paragraph color="$danger" fontSize="$3">
              No active account selected
            </Paragraph>
          )}
        </YStack>

        <YStack gap="$4">
          <TextField
            label="To"
            placeholder="0x..."
            autoCapitalize="none"
            autoCorrect={false}
            value={to}
            onChangeText={(next) => setTo(next)}
            disabled={pending}
            errorText={submitted ? (errors.toError ?? undefined) : undefined}
          />

          <TextField
            label="Amount (native)"
            placeholder="0.01"
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="decimal"
            value={valueEther}
            onChangeText={(next) => setValueEther(next)}
            disabled={pending}
            errorText={submitted ? (errors.valueError ?? undefined) : undefined}
          />
        </YStack>

        {errorMessage ? (
          <Paragraph color="$danger" fontSize="$3">
            {errorMessage}
          </Paragraph>
        ) : null}
      </YStack>
    </Screen>
  );
}
