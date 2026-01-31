import { QueryClient } from "@tanstack/svelte-query";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000,
        refetchOnWindowFocus: true,
        // Keep TanStack Query gcTime at defaults unless perf dictates tweaks.
      },
    },
  });
}
