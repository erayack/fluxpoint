<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { createQuery, createMutation, useQueryClient } from "@tanstack/svelte-query";
  import { fetchEvent, fetchAttempts, replayEvent } from "$lib/queries/index.js";
  import type { WebhookEventStatus, WebhookAttemptLog } from "@repo/api";

  const queryClient = useQueryClient();

  let eventId = $derived($page.params.eventId);
  let resetCircuit = $state(false);

  const eventQuery = createQuery(() => ({
    queryKey: ["inspector", "event", eventId] as const,
    queryFn: () => fetchEvent(eventId),
    refetchInterval: 5000,
  }));

  const attemptsQuery = createQuery(() => ({
    queryKey: ["inspector", "attempts", eventId] as const,
    queryFn: () => fetchAttempts(eventId),
    refetchInterval: 5000,
  }));

  const replayMutation = createMutation(() => ({
    mutationFn: () => replayEvent(eventId, { reset_circuit: resetCircuit }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["inspector"] });
      goto(resolve("/events/[eventId]", { eventId: response.event.id }));
    },
  }));

  function handleReplay() {
    replayMutation.mutate();
  }

  function isReplayDisabled(): boolean {
    if (replayMutation.isPending) return true;
    if (!eventQuery.data) return true;

    const event = eventQuery.data.event;
    if (event.status === "in_flight" && event.lease_expires_at) {
      const leaseExpires = new Date(event.lease_expires_at);
      if (leaseExpires > new Date()) return true;
    }
    return false;
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

  function formatJson(value: string | null | undefined): string {
    if (!value) return "";
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  function formatHeaders(headers: Record<string, string> | null | undefined): string {
    if (!headers) return "";
    return Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
  }

  function getAttemptStatusText(attempt: WebhookAttemptLog): string {
    if (attempt.error_kind) {
      return `Error: ${attempt.error_kind}${attempt.error_message ? ` - ${attempt.error_message}` : ""}`;
    }
    if (attempt.response_status !== null) {
      return `HTTP ${attempt.response_status}`;
    }
    return "Unknown";
  }
</script>

<main>
  <a href={resolve("/", {})} class="back-link">← Back to events</a>

  {#if eventQuery.isPending}
    <p class="loading">Loading event...</p>
  {:else if eventQuery.isError}
    <p class="error">Error: {eventQuery.error.message}</p>
  {:else if eventQuery.data}
    {@const event = eventQuery.data.event}
    {@const targetUrl = eventQuery.data.target_url}
    {@const circuit = eventQuery.data.circuit}

    <header>
      <h1>Event {event.id.slice(0, 8)}...</h1>
      <span class="status-badge {getStatusClass(event.status)}">{event.status}</span>
    </header>

    <section class="event-details">
      <h2>Details</h2>
      <dl>
        <dt>ID</dt>
        <dd>{event.id}</dd>

        {#if event.replayed_from_event_id}
          <dt>Replayed From</dt>
          <dd>
            <a href={resolve("/events/[eventId]", { eventId: event.replayed_from_event_id })}>
              {event.replayed_from_event_id}
            </a>
          </dd>
        {/if}

        <dt>Endpoint ID</dt>
        <dd>{event.endpoint_id}</dd>

        <dt>Provider</dt>
        <dd>{event.provider}</dd>

        <dt>Target URL</dt>
        <dd>{targetUrl}</dd>

        <dt>Attempts</dt>
        <dd>{event.attempts}</dd>

        <dt>Received At</dt>
        <dd>{formatDate(event.received_at)}</dd>

        <dt>Next Attempt</dt>
        <dd>{event.next_attempt_at ? formatDate(event.next_attempt_at) : "—"}</dd>

        <dt>Last Error</dt>
        <dd class="error-text">{event.last_error ?? "—"}</dd>

        {#if circuit}
          <dt>Circuit State</dt>
          <dd>
            <span class="circuit-badge circuit-{circuit.state}">{circuit.state}</span>
            {#if circuit.open_until}
              (until {formatDate(circuit.open_until)})
            {/if}
          </dd>

          <dt>Consecutive Failures</dt>
          <dd>{circuit.consecutive_failures}</dd>
        {/if}
      </dl>
    </section>

    <section class="payload-section">
      <h2>Headers</h2>
      <pre>{formatHeaders(event.headers)}</pre>
    </section>

    <section class="payload-section">
      <h2>Payload</h2>
      <pre>{formatJson(event.payload)}</pre>
    </section>

    <section class="replay-section">
      <h2>Replay</h2>
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={resetCircuit} />
        Reset circuit breaker
      </label>
      <button onclick={handleReplay} disabled={isReplayDisabled()}>
        {replayMutation.isPending ? "Replaying..." : "Replay Event"}
      </button>
      {#if replayMutation.isError}
        <p class="error">Replay failed: {replayMutation.error.message}</p>
      {/if}
    </section>
  {/if}

  <section class="attempts-section">
    <h2>Attempts</h2>

    {#if attemptsQuery.isPending}
      <p class="loading">Loading attempts...</p>
    {:else if attemptsQuery.isError}
      <p class="error">Error: {attemptsQuery.error.message}</p>
    {:else if attemptsQuery.data}
      {#if attemptsQuery.data.attempts.length === 0}
        <p class="empty">No attempts recorded yet.</p>
      {:else}
        {#each attemptsQuery.data.attempts as attempt (attempt.id)}
          <details class="attempt-card">
            <summary>
              <strong>Attempt #{attempt.attempt_no}</strong>
              <span class="attempt-time">{formatDate(attempt.started_at)}</span>
              <span class="attempt-status">{getAttemptStatusText(attempt)}</span>
            </summary>

            <div class="attempt-body">
              <h4>Request Headers</h4>
              <pre>{formatHeaders(attempt.request_headers)}</pre>

              <h4>Request Body</h4>
              <pre>{formatJson(attempt.request_body)}</pre>

              {#if attempt.response_status !== null}
                <h4>Response Status</h4>
                <p>HTTP {attempt.response_status}</p>

                <h4>Response Headers</h4>
                <pre>{formatHeaders(attempt.response_headers)}</pre>

                <h4>Response Body</h4>
                <pre>{formatJson(attempt.response_body)}</pre>
              {/if}

              {#if attempt.error_kind}
                <h4>Error</h4>
                <p class="error-text">
                  <strong>{attempt.error_kind}</strong>: {attempt.error_message ?? "Unknown error"}
                </p>
              {/if}
            </div>
          </details>
        {/each}
      {/if}
    {/if}
  </section>
</main>

<style>
  main {
    max-width: 900px;
    margin: 0 auto;
    padding: 1rem;
  }

  .back-link {
    display: inline-block;
    margin-bottom: 1rem;
    color: #0066cc;
    text-decoration: none;
  }

  .back-link:hover {
    text-decoration: underline;
  }

  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  h1 {
    margin: 0;
  }

  h2 {
    margin-top: 0;
    margin-bottom: 1rem;
    font-size: 1.25rem;
    border-bottom: 1px solid #eee;
    padding-bottom: 0.5rem;
  }

  section {
    margin-bottom: 2rem;
  }

  dl {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 0.5rem 1rem;
  }

  dt {
    font-weight: 600;
    color: #666;
  }

  dd {
    margin: 0;
    word-break: break-word;
  }

  pre {
    background: #f5f5f5;
    padding: 1rem;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.875rem;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .status-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    font-size: 0.875rem;
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

  .circuit-badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .circuit-closed {
    background: #d4edda;
    color: #155724;
  }

  .circuit-open {
    background: #f8d7da;
    color: #721c24;
  }

  .error-text {
    color: #dc3545;
  }

  .replay-section {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  button {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    background: #0066cc;
    color: white;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: #0055aa;
  }

  button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .attempts-section .loading,
  .attempts-section .error,
  .attempts-section .empty {
    padding: 1rem;
    text-align: center;
    color: #666;
  }

  .attempt-card {
    border: 1px solid #ddd;
    border-radius: 4px;
    margin-bottom: 0.5rem;
  }

  .attempt-card summary {
    padding: 0.75rem 1rem;
    cursor: pointer;
    display: flex;
    gap: 1rem;
    align-items: center;
    background: #fafafa;
  }

  .attempt-card summary:hover {
    background: #f0f0f0;
  }

  .attempt-time {
    color: #666;
    font-size: 0.875rem;
  }

  .attempt-status {
    margin-left: auto;
    font-size: 0.875rem;
  }

  .attempt-body {
    padding: 1rem;
    border-top: 1px solid #ddd;
  }

  .attempt-body h4 {
    margin: 1rem 0 0.5rem 0;
    font-size: 0.875rem;
    color: #666;
  }

  .attempt-body h4:first-child {
    margin-top: 0;
  }

  .loading,
  .error {
    padding: 1rem;
    text-align: center;
  }

  .error {
    color: #dc3545;
  }
</style>
