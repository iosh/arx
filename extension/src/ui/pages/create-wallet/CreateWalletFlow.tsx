import type { KeySourceId } from "@arx/core/keyring";
import type { WalletStatus } from "@arx/core/wallet";
import { useBlocker } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { OnboardingLayout } from "@/ui/components/OnboardingLayout";
import { OnboardingStepLayout } from "@/ui/components/OnboardingStepLayout";
import type { MnemonicWord } from "@/ui/components/recovery-phrase/mnemonic";
import { useWalletClient } from "@/ui/wallet/WalletClientContext";
import { CreatePasswordForm } from "./CreatePasswordForm";
import { FirstBackupFlow } from "./FirstBackupFlow";

type CreationState =
  | { status: "idle" | "pending" | "failed" }
  | { status: "created"; keySourceId: KeySourceId; words: readonly MnemonicWord[] };

export function CreateWalletFlow({ walletStatus, onExit }: { walletStatus: WalletStatus; onExit: () => void }) {
  const wallet = useWalletClient();
  const [creation, setCreation] = useState<CreationState>({ status: "idle" });
  const pending = creation.status === "pending";
  const shouldExit =
    creation.status === "created" ? walletStatus === "locked" : !pending && walletStatus !== "uninitialized";

  useBlocker({ shouldBlockFn: () => pending, enableBeforeUnload: false });

  useEffect(() => {
    // The unlocked event may precede the creation response; keep the submitted flow mounted.
    if (shouldExit) onExit();
  }, [shouldExit, onExit]);

  async function createWallet(password: string) {
    setCreation({ status: "pending" });
    try {
      const { mnemonic } = await wallet.keySources.generateMnemonic();
      const { keySourceId } = await wallet.createFromMnemonic({ password, mnemonic, namespace: "eip155" });
      setCreation({
        status: "created",
        keySourceId,
        words: mnemonic.split(" ").map((word, index) => ({ position: index + 1, word })),
      });
    } catch {
      setCreation({ status: "failed" });
    }
  }

  if (shouldExit) return <OnboardingLayout />;

  if (creation.status === "created") {
    return walletStatus === "unlocked" ? (
      <FirstBackupFlow keySourceId={creation.keySourceId} words={creation.words} onExit={onExit} />
    ) : (
      <OnboardingLayout />
    );
  }

  return (
    <OnboardingStepLayout currentStep={1} totalSteps={3} onBack={onExit} backDisabled={pending}>
      <CreatePasswordForm onSubmit={createWallet} pending={pending} failed={creation.status === "failed"} />
    </OnboardingStepLayout>
  );
}
