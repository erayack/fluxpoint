<script lang="ts">
  import "../app.css";
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import { createQueryClient } from "$lib/queries/queryClient.js";

  let { children } = $props();

  const queryClient = createQueryClient();
</script>

<QueryClientProvider client={queryClient}>
  {@render children()}
</QueryClientProvider>
