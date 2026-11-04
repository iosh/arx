import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "always",
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      gcTime: 0,
    },
    mutations: { networkMode: "always", retry: false },
  },
});
