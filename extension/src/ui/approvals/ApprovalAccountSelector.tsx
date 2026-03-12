import type { ApprovalSummary } from "@arx/core/ui";
import { Paragraph, XStack, YStack } from "tamagui";
import { AddressDisplay, Button, Card } from "@/ui/components";

type AccountSelectionApproval = Extract<ApprovalSummary, { type: "requestAccounts" | "requestPermissions" }>;

export function ApprovalAccountSelector({
  approval,
  selectedAccountId,
  onSelect,
}: {
  approval: AccountSelectionApproval;
  selectedAccountId: string | null;
  onSelect: (accountId: string) => void;
}) {
  const selectableAccounts = approval.payload.selectableAccounts;
  const recommendedAccountId = approval.payload.recommendedAccountId;

  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Choose account</Paragraph>
      <Paragraph color="$color10" fontSize="$2">
        Select the account to share with this site on {approval.chainRef}.
      </Paragraph>

      {selectableAccounts.length === 0 ? (
        <Paragraph color="$color10" fontSize="$2">
          No wallet-owned accounts are available for this chain.
        </Paragraph>
      ) : (
        <YStack gap="$2" marginTop="$1">
          {selectableAccounts.map((account) => {
            const isSelected = account.accountId === selectedAccountId;
            const isRecommended = account.accountId === recommendedAccountId;

            return (
              <Card key={account.accountId} padded bordered borderColor={isSelected ? "$accent" : "$border"} gap="$2">
                <AddressDisplay
                  address={account.canonicalAddress}
                  namespace={approval.namespace}
                  chainRef={approval.chainRef}
                  copyable={false}
                />
                <XStack alignItems="center" justifyContent="space-between" gap="$2">
                  <Paragraph color={isSelected ? "$accent" : "$mutedText"} fontSize="$2">
                    {isSelected ? "Selected" : isRecommended ? "Recommended" : "Available"}
                  </Paragraph>
                  <Button
                    size="$3"
                    variant={isSelected ? "primary" : "secondary"}
                    disabled={isSelected}
                    onPress={() => onSelect(account.accountId)}
                  >
                    {isSelected ? "Current" : "Use"}
                  </Button>
                </XStack>
              </Card>
            );
          })}
        </YStack>
      )}
    </Card>
  );
}
