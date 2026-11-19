import type { ApiResponse } from "@/types";

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(action: string, data?: unknown): Promise<T> {
  const response = await fetch(data ? "/api/app" : `/api/app?action=${encodeURIComponent(action)}`, {
    method: data ? "POST" : "GET",
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify({ action, data }) : undefined,
    cache: "no-store",
  });

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError("Unable to reach the ledger server", "NETWORK_ERROR", response.status);
  }
  if (!payload.success) {
    throw new ApiError(
      payload.error?.message || "Unable to complete request",
      payload.error?.code || "REQUEST_FAILED",
      response.status,
    );
  }
  return payload.data as T;
}
