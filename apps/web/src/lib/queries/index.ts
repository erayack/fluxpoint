import type {
  ListEventsResponse,
  GetEventResponse,
  ListAttemptsResponse,
  ReplayEventResponse,
  WebhookEventStatus,
  ApiErrorResponse,
} from "@repo/api";
import { ApiClientError } from "$lib/errors/index.js";

export interface FetchEventsParams {
  limit?: number;
  before?: string | null;
  status?: WebhookEventStatus | null;
  endpoint_id?: string | null;
  provider?: string | null;
}

function getHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function parseApiError(data: unknown): ApiErrorResponse | undefined {
  if (
    typeof data === "object" &&
    data !== null &&
    "code" in data &&
    "message" in data &&
    typeof (data as { code: unknown }).code === "string" &&
    typeof (data as { message: unknown }).message === "string"
  ) {
    return data as ApiErrorResponse;
  }
  return undefined;
}

async function handleErrorResponse(response: Response): Promise<never> {
  const data = await response.json().catch(() => undefined);
  const apiError = parseApiError(data);
  throw new ApiClientError(response.status, apiError);
}

export async function fetchEvents(params: FetchEventsParams = {}): Promise<ListEventsResponse> {
  const searchParams = new URLSearchParams();

  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.before) searchParams.set("before", params.before);
  if (params.status) searchParams.set("status", params.status);
  if (params.endpoint_id) searchParams.set("endpoint_id", params.endpoint_id);
  if (params.provider) searchParams.set("provider", params.provider);

  const query = searchParams.toString();
  const url = `/api/inspector/events${query ? `?${query}` : ""}`;

  const response = await fetch(url, { headers: getHeaders() });

  if (!response.ok) {
    await handleErrorResponse(response);
  }

  return response.json();
}

export async function fetchEvent(eventId: string): Promise<GetEventResponse> {
  const response = await fetch(`/api/inspector/events/${eventId}`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    await handleErrorResponse(response);
  }

  return response.json();
}

export async function fetchAttempts(eventId: string): Promise<ListAttemptsResponse> {
  const response = await fetch(`/api/inspector/events/${eventId}/attempts`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    await handleErrorResponse(response);
  }

  return response.json();
}

export interface ReplayEventParams {
  reset_circuit?: boolean;
}

export async function replayEvent(
  eventId: string,
  params: ReplayEventParams = {},
): Promise<ReplayEventResponse> {
  const response = await fetch(`/api/inspector/events/${eventId}/replay`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ reset_circuit: params.reset_circuit ?? false }),
  });

  if (!response.ok) {
    await handleErrorResponse(response);
  }

  return response.json();
}
