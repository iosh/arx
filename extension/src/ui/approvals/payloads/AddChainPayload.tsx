import type { ApprovalSummary } from "@arx/core/ui";
import { Card, Paragraph, YStack } from "tamagui";

type AddChainApproval = Extract<ApprovalSummary, { type: "addChain" }>;

export function AddChainPayload({ approval }: { approval: AddChainApproval }) {
  const { payload } = approval;

  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">{payload.isUpdate ? "Update Network" : "Add Network"}</Paragraph>
      <Paragraph color="$color10" fontSize="$2">
        {payload.isUpdate
          ? "This site wants to update an existing network configuration."
          : "This site wants to add a new network to your wallet."}
      </Paragraph>

      <YStack gap="$1" marginTop="$2">
        <Paragraph fontSize="$2">Network Name:</Paragraph>
        <Paragraph fontFamily="$mono" fontSize="$2">
          {payload.displayName}
        </Paragraph>
      </YStack>

      <YStack gap="$1">
        <Paragraph fontSize="$2">Chain ID:</Paragraph>
        <Paragraph fontFamily="$mono" fontSize="$2">
          {payload.chainId}
        </Paragraph>
      </YStack>

      {payload.nativeCurrency && (
        <YStack gap="$1">
          <Paragraph fontSize="$2">Currency:</Paragraph>
          <Paragraph fontFamily="$mono" fontSize="$2">
            {payload.nativeCurrency.symbol} ({payload.nativeCurrency.name})
          </Paragraph>
        </YStack>
      )}

      <YStack gap="$1">
        <Paragraph fontSize="$2">RPC URL{payload.rpcUrls.length > 1 ? "s" : ""}:</Paragraph>
        {payload.rpcUrls.map((url) => (
          <Paragraph key={url} fontFamily="$mono" fontSize="$2" numberOfLines={1}>
            {url}
          </Paragraph>
        ))}
      </YStack>

      {payload.blockExplorerUrl && (
        <YStack gap="$1">
          <Paragraph fontSize="$2">Block Explorer:</Paragraph>
          <Paragraph fontFamily="$mono" fontSize="$2" numberOfLines={1}>
            {payload.blockExplorerUrl}
          </Paragraph>
        </YStack>
      )}
    </Card>
  );
}
