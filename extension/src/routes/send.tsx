import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { LoadingScreen } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { requireSetupComplete } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { uiClient } from "@/ui/lib/uiBridgeClient";
import { SendScreen } from "@/ui/screens/SendScreen";

export const Route = createFileRoute("/send")({
  beforeLoad: requireSetupComplete,
  component: SendPage,
});

function SendPage() {
  const router = useRouter();
  const { snapshot, isLoading } = useUiSnapshot();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (isLoading || !snapshot) {
    return <LoadingScreen />;
  }

  return (
    <SendScreen
      snapshot={snapshot}
      pending={pending}
      errorMessage={errorMessage}
      onCancel={() => router.navigate({ to: ROUTES.HOME })}
      onSubmit={(params) => {
        if (pending) return;

        setPending(true);
        setErrorMessage(null);

        void uiClient.transactions
          .requestSendTransactionApproval({
            to: params.to,
            valueEther: params.valueEther,
            chainRef: snapshot.chain.chainRef,
          })
          .then(async ({ approvalId }) => {
            // Wait for the snapshot to include the approval so the approve route doesn't bounce.
            await uiClient.waitForSnapshot({
              timeoutMs: 2_000,
              predicate: (s) => s.approvals.some((item) => item.id === approvalId),
            });

            await router.navigate({
              to: "/approve/send-transaction/$id",
              params: { id: approvalId },
              replace: true,
            });
          })
          .catch((error) => {
            setErrorMessage(getErrorMessage(error));
          })
          .finally(() => {
            setPending(false);
          });
      }}
    />
  );
}
