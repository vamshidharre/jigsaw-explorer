import type { CreateRoomRequest, CreateRoomResponse, RoomSummary, UploadResponse } from '../../shared/protocol';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) throw new ApiError('The server took too long to respond. Please try again.', 0);
    throw new ApiError(navigator.onLine === false ? 'You appear to be offline.' : 'Could not reach the server. Check your connection and try again.', 0);
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON error page (e.g. a proxy error)
  }
  if (!res.ok) {
    const message = (body as { error?: string } | null)?.error ?? `The server returned an error (${res.status}).`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export function createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
  return request('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
}

export function getRoom(code: string): Promise<RoomSummary> {
  return request(`/api/rooms/${encodeURIComponent(code)}`);
}

export function uploadImage(blob: Blob): Promise<UploadResponse> {
  return request('/api/uploads', { method: 'POST', headers: { 'content-type': blob.type || 'application/octet-stream' }, body: blob }, 60_000);
}
