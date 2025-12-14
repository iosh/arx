import type { ApprovalSummary } from "@arx/core/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Card, Paragraph, ScrollView, XStack, YStack } from "tamagui";
import { Button, LoadingScreen } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";

export const Route = createFileRoute("/approvals")({
  beforeLoad: requireVaultInitialized,
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const router = useRouter();
  const { snapshot, isLoading, approveApproval, rejectApproval } = useUiSnapshot();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (isLoading || !snapshot) {
    return <LoadingScreen />;
  }

  const selected = snapshot.approvals.find((a) => a.id === selectedId);

  const handleApprove = async (id: string) => {
    setPending("approve");
    setErrorMessage(null);
    try {
      await approveApproval(id);
      setSelectedId(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPending(null);
    }
  };

  const handleReject = async (id: string) => {
    setPending("reject");
    setErrorMessage(null);
    try {
      await rejectApproval({ id, reason: "User rejected" });
      setSelectedId(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPending(null);
    }
  };

  if (selected) {
    return (
      <ApprovalDetail
        approval={selected}
        onApprove={() => void handleApprove(selected.id)}
        onReject={() => void handleReject(selected.id)}
        onBack={() => setSelectedId(null)}
        pending={pending}
        errorMessage={errorMessage}
      />
    );
  }

  return (
    <YStack flex={1} gap="$3" padding="$4">
      <Button onPress={() => router.navigate({ to: ROUTES.HOME })}>Back</Button>

      <Card padded bordered gap="$2">
        <Paragraph fontSize="$6" fontWeight="600">
          Pending Approvals
        </Paragraph>
        <Paragraph color="$color10" fontSize="$2">
          {snapshot.approvals.length} pending
        </Paragraph>
      </Card>

      {snapshot.approvals.length === 0 ? (
        <Card padded bordered>
          <Paragraph color="$color10">No pending approvals</Paragraph>
        </Card>
      ) : (
        <ScrollView flex={1}>
          <YStack gap="$2">
            {snapshot.approvals.map((approval) => (
              <ApprovalListItem key={approval.id} approval={approval} onSelect={() => setSelectedId(approval.id)} />
            ))}
          </YStack>
        </ScrollView>
      )}
    </YStack>
  );
}

function ApprovalListItem({ approval, onSelect }: { approval: ApprovalSummary; onSelect: () => void }) {
  const typeLabel = getTypeLabel(approval.type);

  return (
    <Card padded bordered pressTheme onPress={onSelect}>
      <XStack justifyContent="space-between" alignItems="center">
        <YStack gap="$1" flex={1}>
          <Paragraph fontWeight="600">{typeLabel}</Paragraph>
          <Paragraph color="$color10" fontSize="$2" numberOfLines={1}>
            {approval.origin}
          </Paragraph>
        </YStack>
        <Paragraph color="$color10" fontSize="$2">
          {approval.chainRef}
        </Paragraph>
      </XStack>
    </Card>
  );
}

function ApprovalDetail({
  approval,
  onApprove,
  onReject,
  onBack,
  pending,
  errorMessage,
}: {
  approval: ApprovalSummary;
  onApprove: () => void;
  onReject: () => void;
  onBack: () => void;
  pending: "approve" | "reject" | null;
  errorMessage: string | null;
}) {
  return (
    <YStack flex={1} gap="$3" padding="$4">
      <Button onPress={onBack} disabled={pending !== null}>
        Back
      </Button>

      <Card padded bordered gap="$2">
        <Paragraph fontSize="$6" fontWeight="600">
          {getTypeLabel(approval.type)}
        </Paragraph>
        <Paragraph color="$color10" fontSize="$2">
          {approval.origin}
        </Paragraph>
        <Paragraph color="$color10" fontSize="$2">
          Chain: {approval.chainRef}
        </Paragraph>
      </Card>

      <ScrollView flex={1}>
        <ApprovalPayloadDetail approval={approval} />
      </ScrollView>

      {errorMessage && (
        <Card padded bordered borderColor="$red7" backgroundColor="$red2">
          <Paragraph color="$red10" fontSize="$2">
            {errorMessage}
          </Paragraph>
        </Card>
      )}

      <XStack gap="$3">
        <Button flex={1} onPress={onReject} disabled={pending !== null} backgroundColor="$red9">
          {pending === "reject" ? "Rejecting..." : "Reject"}
        </Button>
        <Button flex={1} onPress={onApprove} disabled={pending !== null} backgroundColor="$green9">
          {pending === "approve" ? "Approving..." : "Approve"}
        </Button>
      </XStack>
    </YStack>
  );
}

function ApprovalPayloadDetail({ approval }: { approval: ApprovalSummary }) {
  switch (approval.type) {
    case "requestAccounts":
      return (
        <Card padded bordered gap="$2">
          <Paragraph fontWeight="600">Connect Account</Paragraph>
          <Paragraph color="$color10" fontSize="$2">
            This site wants to view your account address.
          </Paragraph>
          {approval.payload.suggestedAccounts.length > 0 && (
            <YStack gap="$1" marginTop="$2">
              <Paragraph fontSize="$2">Accounts:</Paragraph>
              {approval.payload.suggestedAccounts.map((addr) => (
                <Paragraph key={addr} fontFamily="$mono" fontSize="$2">
                  {addr}
                </Paragraph>
              ))}
            </YStack>
          )}
        </Card>
      );

    case "signMessage":
      return (
        <Card padded bordered gap="$2">
          <Paragraph fontWeight="600">Sign Message</Paragraph>
          <Paragraph color="$color10" fontSize="$2">
            From: {approval.payload.from}
          </Paragraph>
          <YStack marginTop="$2" padding="$2" backgroundColor="$backgroundFocus" borderRadius="$2">
            <Paragraph fontFamily="$mono" fontSize="$2">
              {approval.payload.message}
            </Paragraph>
          </YStack>
        </Card>
      );

    case "signTypedData":
      return (
        <Card padded bordered gap="$2">
          <Paragraph fontWeight="600">Sign Typed Data</Paragraph>
          <Paragraph color="$color10" fontSize="$2">
            From: {approval.payload.from}
          </Paragraph>
          <YStack marginTop="$2" padding="$2" backgroundColor="$backgroundFocus" borderRadius="$2">
            <Paragraph fontFamily="$mono" fontSize="$2">
              {formatTypedData(approval.payload.typedData)}
            </Paragraph>
          </YStack>
        </Card>
      );

    case "sendTransaction":
      return (
        <Card padded bordered gap="$2">
          <Paragraph fontWeight="600">Send Transaction</Paragraph>
          <YStack gap="$1">
            <DetailRow label="From" value={approval.payload.from} mono />
            <DetailRow label="To" value={approval.payload.to ?? "Contract Creation"} mono />
            {approval.payload.value && <DetailRow label="Value" value={approval.payload.value} />}
            {approval.payload.gas && <DetailRow label="Gas Limit" value={approval.payload.gas} />}
            {approval.payload.data && (
              <YStack marginTop="$2">
                <Paragraph fontSize="$2" color="$color10">
                  Data:
                </Paragraph>
                <Paragraph fontFamily="$mono" fontSize="$1" numberOfLines={3}>
                  {approval.payload.data}
                </Paragraph>
              </YStack>
            )}
          </YStack>
          {approval.payload.warnings && approval.payload.warnings.length > 0 && (
            <YStack marginTop="$2" gap="$1">
              {approval.payload.warnings.map((w, i) => (
                <Paragraph key={i} color="$orange10" fontSize="$2">
                  ⚠ {w.message}
                </Paragraph>
              ))}
            </YStack>
          )}
          {approval.payload.issues && approval.payload.issues.length > 0 && (
            <YStack marginTop="$2" gap="$1">
              {approval.payload.issues.map((issue, i) => (
                <Paragraph key={i} color="$red10" fontSize="$2">
                  ✕ {issue.message}
                </Paragraph>
              ))}
            </YStack>
          )}
        </Card>
      );
    case "requestPermissions":
      return (
        <Card padded bordered gap="$2">
          <Paragraph fontWeight="600">Permission Request</Paragraph>
          <YStack gap="$2" marginTop="$2">
            {approval.payload.permissions.map((perm, index) => (
              <Card key={`${perm.capability}-${index}`} padded bordered>
                <Paragraph fontWeight="600">{perm.capability}</Paragraph>
                <Paragraph color="$color10" fontSize="$2">
                  Scope: {perm.scope}
                </Paragraph>
                <Paragraph color="$color10" fontSize="$2">
                  Chains: {perm.chains.join(", ")}
                </Paragraph>
              </Card>
            ))}
          </YStack>
        </Card>
      );
    default:
      return (
        <Card padded bordered>
          <Paragraph color="$color10">Unknown approval type</Paragraph>
        </Card>
      );
  }
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <XStack justifyContent="space-between" gap="$2">
      <Paragraph color="$color10" fontSize="$2">
        {label}:
      </Paragraph>
      <Paragraph fontSize="$2" fontFamily={mono ? "$mono" : undefined} numberOfLines={1} flex={1} textAlign="right">
        {value}
      </Paragraph>
    </XStack>
  );
}

function getTypeLabel(type: ApprovalSummary["type"]): string {
  switch (type) {
    case "requestAccounts":
      return "Connect Account";
    case "signMessage":
      return "Sign Message";
    case "signTypedData":
      return "Sign Typed Data";
    case "sendTransaction":
      return "Send Transaction";
    case "requestPermissions":
      return "Permission Request";
    default:
      return "Unknown Request";
  }
}

function formatTypedData(data: string): string {
  try {
    const parsed = JSON.parse(data);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return data;
  }
}
