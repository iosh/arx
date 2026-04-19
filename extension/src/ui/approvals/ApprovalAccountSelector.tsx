import type { ApprovalDetail } from "@arx/core/ui";
import { Paragraph, XStack, YStack } from "tamagui";
import { AddressDisplay, Button, Card } from "@/ui/components";

type AccountSelectionApproval = Extract<ApprovalDetail, { kind: "requestAccounts" | "requestPermissions" }>;

export function ApprovalAccountSelector({
  approval,
  selectedAccountKey,
  onSelect,
}: {
  approval: AccountSelectionApproval;
  selectedAccountKey: string | null;
  onSelect: (accountKey: string) => void;
}) {
  const selectableAccounts = approval.request.selectableAccounts;
  const recommendedAccountKey = approval.request.recommendedAccountKey;

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
            const isSelected = account.accountKey === selectedAccountKey;
            const isRecommended = account.accountKey === recommendedAccountKey;

            return (
              <Card key={account.accountKey} padded bordered borderColor={isSelected ? "$accent" : "$border"} gap="$2">
                <AddressDisplay
                  address={account.canonicalAddress}
                  displayAddress={account.displayAddress}
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
                    onPress={() => onSelect(account.accountKey)}
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
