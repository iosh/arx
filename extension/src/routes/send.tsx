import { createFileRoute, useRouter } from "@tanstack/react-router";
import { LoadingScreen } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { requireSetupComplete } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { SendScreen } from "@/ui/screens/SendScreen";
import { useSendApprovalAction } from "@/ui/send/useSendApprovalAction";

export const Route = createFileRoute("/send")({
  beforeLoad: requireSetupComplete,
  component: SendPage,
});

function SendPage() {
  const router = useRouter();
  const { snapshot, isLoading } = useUiSnapshot();
  const { pending, errorMessage, submitSendApproval } = useSendApprovalAction();

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
        void submitSendApproval({
          to: params.to,
          valueEther: params.valueEther,
          chainRef: snapshot.chain.chainRef,
        });
      }}
    />
  );
}
