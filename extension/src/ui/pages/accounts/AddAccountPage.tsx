import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmAccountMoveSheet } from "@/ui/components/accounts/ConfirmAccountMoveSheet";
import { PageHeader } from "@/ui/components/PageHeader";
import { Button } from "@/ui/components/ui/button";
import { Spinner } from "@/ui/components/ui/spinner";
import { useSelectedAccount } from "@/ui/wallet/accounts/useSelectedAccount";
import { useHdWallets } from "@/ui/wallet/keyring/useMnemonicSources";
import { useAccountCreation } from "./useAccountCreation";

export function AddAccountPage() {
  const { t } = useTranslation("wallet");
  const navigate = useNavigate();
  const { data: wallets = [], isPending, isSuccess } = useHdWallets();
  const {
    data: selectedAccount,
    isPending: selectedAccountPending,
    isSuccess: selectedAccountLoaded,
  } = useSelectedAccount();
  const targets = wallets.flatMap(({ source, hdKeyrings }) =>
    hdKeyrings
      .filter((keyring) => keyring.namespace === selectedAccount?.namespace)
      .map((hdKeyring) => ({ source, hdKeyring })),
  );
  const creation = useAccountCreation(() => {
    void navigate({ to: "/wallet/accounts", replace: true });
  });
  const { candidate } = creation;

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${t("add")} · ARX`}</title>
      <PageHeader title={t("add")} backTo="/wallet/accounts" backLabel={t("backToAccounts")} />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-3.5">
        {(isPending || selectedAccountPending) && (
          <div className="flex min-h-14 items-center px-4 text-muted-foreground">
            <Spinner aria-label={t("loadingWallet")} />
          </div>
        )}
        {isSuccess && selectedAccountLoaded && targets.length === 0 && (
          <p className="px-4 py-4 text-sm text-muted-foreground">{t("noHdWallet")}</p>
        )}
        {targets.length > 0 && (
          <section className="shrink-0 rounded-2xl bg-card py-1 text-card-foreground">
            {targets.map(({ source, hdKeyring }) => (
              <Button
                key={hdKeyring.hdKeyringId}
                type="button"
                variant="ghost"
                disabled={creation.isPending}
                className="h-auto min-h-15 w-full justify-start gap-3 px-4 py-2 text-left whitespace-normal"
                onClick={(event) =>
                  creation.create({ hdKeyringId: hdKeyring.hdKeyringId, walletName: source.name }, event.currentTarget)
                }
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                  {creation.creatingKeyringId === hdKeyring.hdKeyringId ? (
                    <Spinner aria-label={t("creatingAccount")} />
                  ) : (
                    <Plus aria-hidden="true" className="size-4" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-semibold">{t("createAccount")}</span>
                  <span className="text-xs font-medium text-muted-foreground wrap-anywhere">
                    {t("addToWallet", { walletName: source.name })}
                  </span>
                </span>
              </Button>
            ))}
          </section>
        )}
      </div>
      {candidate && (
        <ConfirmAccountMoveSheet
          account={candidate.account}
          walletName={candidate.target.walletName}
          isPending={creation.isPending}
          onCancel={creation.cancel}
          onConfirm={() => creation.move(candidate)}
          returnFocusRef={creation.returnFocusRef}
        />
      )}
    </main>
  );
}
