import { type MutateOptions, type UseMutationOptions, useMutation } from "@tanstack/react-query";
import { useWalletError } from "./useWalletError";

type WalletMutationOptions<TData, TVariables> = Pick<UseMutationOptions<TData, Error, TVariables>, "gcTime"> & {
  mutationFn(variables: TVariables): Promise<TData>;
  toasterId?: string | ((variables: TVariables) => string | undefined);
};

/** Passes only command variables and supplies a failure notice unless per-call onError replaces it. */
export function useWalletMutation<TData, TVariables = void>({
  toasterId,
  mutationFn,
  ...options
}: WalletMutationOptions<TData, TVariables>) {
  const mutation = useMutation({ ...options, mutationFn: (variables: TVariables) => mutationFn(variables) });
  const reportError = useWalletError();

  function withErrorFeedback(
    callbacks?: MutateOptions<TData, Error, TVariables>,
  ): MutateOptions<TData, Error, TVariables> {
    return {
      ...callbacks,
      onError:
        callbacks?.onError ??
        ((error, variables) => {
          reportError(error, typeof toasterId === "function" ? toasterId(variables) : toasterId);
        }),
    };
  }

  return {
    ...mutation,
    mutate(...args: Parameters<typeof mutation.mutate>) {
      args[1] = withErrorFeedback(args[1]);
      mutation.mutate(...args);
    },
    mutateAsync(...args: Parameters<typeof mutation.mutateAsync>) {
      args[1] = withErrorFeedback(args[1]);
      return mutation.mutateAsync(...args);
    },
  };
}
