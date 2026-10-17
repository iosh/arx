import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

export function useCopyToClipboard() {
  const resetTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {
    mutate,
    isPending: isCopying,
    isSuccess: copied,
    isError: copyFailed,
    reset,
  } = useMutation({
    mutationFn: (text: string) => navigator.clipboard.writeText(text),
  });

  useEffect(() => () => clearTimeout(resetTimeout.current), []);

  function copy(text: string) {
    clearTimeout(resetTimeout.current);
    mutate(text, {
      // Per-call callbacks stop with the component, so unmounting cannot start another timer.
      onSuccess: () => {
        resetTimeout.current = setTimeout(reset, 1_000);
      },
    });
  }

  return { copy, isCopying, copied, copyFailed };
}
