import type { UiMethodResult } from "@arx/core/ui";
import { Check, ChevronDown, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Paragraph, useTheme, XStack, YStack } from "tamagui";
import { copyToClipboard } from "@/ui/lib/clipboard";
import { formatTokenAmount } from "@/ui/lib/format";
import { AddressDisplay } from "./AddressDisplay";
import { Button } from "./Button";

export type AccountCardProps = {
  address: string | null;
  displayAddress: string | null;
  nativeBalance: UiMethodResult<"ui.balances.getNative"> | null;
  balanceLoading: boolean;
  balanceError: string | null;
  fallbackCurrencySymbol: string;
  onPressAccount: () => void;
};

export function AccountCard({
  address,
  displayAddress,
  nativeBalance,
  balanceLoading,
  balanceError,
  fallbackCurrencySymbol,
  onPressAccount,
}: AccountCardProps) {
  const theme = useTheme();
  const [hideBalance, setHideBalance] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyValue = useMemo(() => displayAddress?.trim() || address?.trim() || null, [address, displayAddress]);

  useEffect(() => {
    if (!copied) return;
    const handle = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(handle);
  }, [copied]);

  const handleCopy = () => {
    if (!copyValue) return;
    copyToClipboard(copyValue)
      .then(() => {
        setCopied(true);
      })
      .catch((error) => {
        console.warn("[AccountCard] failed to copy", error);
      });
  };

  const formattedBalance = useMemo(() => {
    if (!nativeBalance) return null;
    return formatTokenAmount(nativeBalance.amount, nativeBalance.currency.decimals, { maxFractionDigits: 6 });
  }, [nativeBalance]);
  const balanceSymbol = nativeBalance?.currency.symbol ?? fallbackCurrencySymbol;

  return (
    <YStack alignItems="center" gap="$4" paddingVertical="$2">
      {/* Account Pill */}
      <XStack
        backgroundColor="$surface"
        borderRadius="$full"
        paddingHorizontal="$1.5"
        paddingVertical="$1.5"
        alignItems="center"
        gap="$1"
        hoverStyle={{ backgroundColor: "$cardBg" }}
        borderWidth={1}
        borderColor="$border"
      >
        <Button
          size="$3"
          variant="ghost"
          borderRadius="$full"
          paddingHorizontal="$3"
          height={32}
          onPress={onPressAccount}
          disabled={!address}
          hoverStyle={{ backgroundColor: "transparent" }}
        >
          <XStack alignItems="center" gap="$2">
            {address ? (
              <AddressDisplay
                address={address}
                displayAddress={displayAddress}
                copyable={false}
                interactive={false}
                fontSize="$3"
                fontWeight="500"
                color="$text"
              />
            ) : (
              <Paragraph fontFamily="$mono" fontSize="$3" fontWeight="500" color="$text">
                No Account
              </Paragraph>
            )}
            <ChevronDown size={14} color={theme.mutedText.get()} />
          </XStack>
        </Button>

        {address && (
          <>
            <XStack width={1} height={16} backgroundColor="$border" />
            <Button
              size="$3"
              variant="ghost"
              circular
              width={32}
              height={32}
              aria-label={copied ? "Copied" : "Copy address"}
              icon={
                copied ? (
                  <Check size={14} color={theme.success.get()} />
                ) : (
                  <Copy size={14} color={theme.mutedText.get()} />
                )
              }
              onPress={handleCopy}
              hoverStyle={{ backgroundColor: "$background" }}
            />
          </>
        )}
      </XStack>

      {/* Balance Display */}
      <YStack alignItems="center" gap="$1">
        {!address ? (
          <Paragraph color="$mutedText" fontSize="$5">
            Select an account
          </Paragraph>
        ) : balanceLoading ? (
          <YStack width={140} height={44} borderRadius="$md" backgroundColor="$surface" opacity={0.5} />
        ) : (
          <XStack
            alignItems="baseline"
            gap="$2"
            onPress={() => setHideBalance((v) => !v)}
            cursor="pointer"
            hoverStyle={{ opacity: 0.8 }}
          >
            <Paragraph color="$text" fontSize={42} fontWeight="600" letterSpacing={-1}>
              {hideBalance ? "••••" : (formattedBalance ?? "0")}
            </Paragraph>
            <Paragraph color="$mutedText" fontSize="$5" fontWeight="500" paddingBottom="$1">
              {balanceSymbol}
            </Paragraph>
          </XStack>
        )}

        {balanceError && (
          <Paragraph color="$danger" fontSize="$2">
            {balanceError}
          </Paragraph>
        )}
      </YStack>
    </YStack>
  );
}
