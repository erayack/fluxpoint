<script lang="ts">
  import { getErrorMessage } from "../errors.js";

  interface Props {
    error: unknown;
    class?: string;
  }

  const { error, class: className = "" }: Props = $props();
</script>

<p class="error-message {className}">{getErrorMessage(error)}</p>

<style>
  .error-message {
    color: #dc3545;
    padding: 1rem;
    text-align: center;
  }
</style>
