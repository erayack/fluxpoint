<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { resolve } from "$app/paths";
  import { fetchEvents, type FetchEventsParams } from "$lib/queries/index.js";
  import type { WebhookEventStatus } from "@repo/api";

  const STATUS_OPTIONS: Array<WebhookEventStatus | ""> = [
    "",
    "pending",
    "in_flight",
    "requeued",
    "delivered",
    "dead",
    "paused",
  ];

  let filters = $state<FetchEventsParams>({
    limit: 50,
    status: null,
    endpoint_id: null,
    provider: null,
  });

  let cursor = $state<string | null>(null);

  let statusFilter = $state<WebhookEventStatus | "">("");
  let endpointFilter = $state("");
  let providerFilter = $state("");

  function applyFilters() {
    filters = {
      ...filters,
      status: statusFilter || null,
      endpoint_id: endpointFilter || null,
      provider: providerFilter || null,
    };
    cursor = null;
  }

  function resetFilters() {
    statusFilter = "";
    endpointFilter = "";
    providerFilter = "";
    filters = { limit: 50, status: null, endpoint_id: null, provider: null };
    cursor = null;
  }

  const eventsQuery = createQuery(() => ({
    queryKey: ["inspector", "events", filters, cursor] as const,
    queryFn: () => fetchEvents({ ...filters, before: cursor }),
    refetchInterval: 3000,
  }));

  function loadOlder() {
    if (eventsQuery.data?.next_before) {
      cursor = eventsQuery.data.next_before;
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  function getStatusClass(status: WebhookEventStatus): string {
    switch (status) {
      case "delivered":
        return "status-delivered";
      case "dead":
        return "status-dead";
      case "pending":
        return "status-pending";
      case "in_flight":
        return "status-in-flight";
      case "requeued":
        return "status-requeued";
      case "paused":
        return "status-paused";
      default:
        return "";
    }
  }
</script>

<main>
  <h1>Webhook Events</h1>

  <section class="filters">
    <label>
      Status
      <select bind:value={statusFilter}>
        {#each STATUS_OPTIONS as opt (opt)}
          <option value={opt}>{opt || "All"}</option>
        {/each}
      </select>
    </label>

    <label>
      Endpoint ID
      <input type="text" bind:value={endpointFilter} placeholder="Filter by endpoint" />
    </label>

    <label>
      Provider
      <input type="text" bind:value={providerFilter} placeholder="Filter by provider" />
    </label>

    <button onclick={applyFilters}>Apply</button>
    <button onclick={resetFilters} class="secondary">Reset</button>
  </section>

  {#if eventsQuery.isPending}
    <p class="loading">Loading events...</p>
  {:else if eventsQuery.isError}
    <p class="error">Error: {eventsQuery.error.message}</p>
  {:else if eventsQuery.data}
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Provider</th>
          <th>Status</th>
          <th>Attempts</th>
          <th>Received</th>
          <th>Next Attempt</th>
          <th>Last Error</th>
        </tr>
      </thead>
      <tbody>
        {#each eventsQuery.data.events as item (item.event.id)}
          <tr>
            <td>
              <a href={resolve(`/events/${item.event.id}`)}>{item.event.id.slice(0, 8)}...</a>
            </td>
            <td>{item.event.provider}</td>
            <td>
              <span class="status-badge {getStatusClass(item.event.status)}">
                {item.event.status}
              </span>
            </td>
            <td>{item.event.attempts}</td>
            <td>{formatDate(item.event.received_at)}</td>
            <td>{item.event.next_attempt_at ? formatDate(item.event.next_attempt_at) : "—"}</td>
            <td class="error-cell" title={item.event.last_error ?? ""}>
              {item.event.last_error ? item.event.last_error.slice(0, 40) : "—"}
            </td>
          </tr>
        {:else}
          <tr>
            <td colspan="7" class="empty">No events found</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="pagination">
      {#if cursor}
        <button onclick={() => (cursor = null)}>Back to latest</button>
      {/if}
      {#if eventsQuery.data.next_before}
        <button onclick={loadOlder}>Load older</button>
      {/if}
    </div>
  {/if}
</main>

<style>
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1rem;
  }

  h1 {
    margin-bottom: 1rem;
  }

  .filters {
    display: flex;
    gap: 1rem;
    align-items: flex-end;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .filters label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.875rem;
  }

  .filters input,
  .filters select {
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
  }

  button {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    background: #0066cc;
    color: white;
    cursor: pointer;
  }

  button:hover {
    background: #0055aa;
  }

  button.secondary {
    background: #666;
  }

  button.secondary:hover {
    background: #555;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid #eee;
  }

  th {
    background: #f5f5f5;
    font-weight: 600;
  }

  tbody tr:hover {
    background: #fafafa;
  }

  .status-badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .status-delivered {
    background: #d4edda;
    color: #155724;
  }

  .status-dead {
    background: #f8d7da;
    color: #721c24;
  }

  .status-pending {
    background: #fff3cd;
    color: #856404;
  }

  .status-in-flight {
    background: #cce5ff;
    color: #004085;
  }

  .status-requeued {
    background: #e2e3e5;
    color: #383d41;
  }

  .status-paused {
    background: #d6d8db;
    color: #1b1e21;
  }

  .error-cell {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #666;
  }

  .empty {
    text-align: center;
    color: #999;
    padding: 2rem;
  }

  .loading,
  .error {
    padding: 1rem;
    text-align: center;
  }

  .error {
    color: #dc3545;
  }

  .pagination {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
    justify-content: center;
  }

  a {
    color: #0066cc;
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }
</style>
