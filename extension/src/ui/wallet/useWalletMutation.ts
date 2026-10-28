import { type MutateOptions, type UseMutationOptions, useMutation } from "@tanstack/react-query";
import { useWalletError } from "./useWalletError";

type WalletMutationOptions<TData, TVariables> = Pick<
  UseMutationOptions<TData, Error, TVariables>,
  "mutationFn" | "gcTime"
> & {
  toasterId?: string | ((variables: TVariables) => string | undefined);
};

/** Supplies a default failure notice while mounted; per-call onError can replace it. */
export function useWalletMutation<TData, TVariables = void>({
  toasterId,
  ...options
}: WalletMutationOptions<TData, TVariables>) {
  const mutation = useMutation(options);
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
