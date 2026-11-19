import { NextRequest, NextResponse } from "next/server";

function failure(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, data: null, error: { code, message } }, { status });
}

function isAuthenticated(request: NextRequest) {
  const session = request.cookies.get("my-ledger-session")?.value;
  return Boolean(session && process.env.APP_ACCESS_PASSWORD && session === process.env.APP_ACCESS_PASSWORD);
}

async function forwardToAppsScript(
  url: URL,
  init: RequestInit,
  action: string,
): Promise<NextResponse> {
  let upstream: Response;
  try {
    upstream = await fetch(url, { ...init, redirect: "follow", cache: "no-store" });
  } catch (error) {
    console.error("[ledger-api] Google Apps Script request failed", {
      action,
      method: init.method,
      error: error instanceof Error ? error.message : "Unknown network error",
    });
    return failure(502, "NETWORK_ERROR", "Unable to reach Google Sheets");
  }

  const contentType = upstream.headers.get("content-type") || "";
  const body = await upstream.text();
  if (!upstream.ok || !contentType.toLowerCase().includes("json")) {
    console.error("[ledger-api] Google Apps Script returned an unexpected response", {
      action,
      method: init.method,
      status: upstream.status,
      contentType,
    });
    return failure(502, "UPSTREAM_ERROR", "Google Sheets returned an invalid response. Check the Apps Script deployment and access settings.");
  }

  try {
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== "object" || !("success" in payload)) {
      throw new Error("Missing success field");
    }
  } catch (error) {
    console.error("[ledger-api] Google Apps Script returned malformed JSON", {
      action,
      method: init.method,
      error: error instanceof Error ? error.message : "Invalid JSON",
    });
    return failure(502, "INVALID_UPSTREAM_RESPONSE", "Google Sheets returned malformed data");
  }

  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function getAppsScriptUrl(): URL | null {
  const configuredUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) return failure(401, "UNAUTHORIZED", "Please sign in");
  const url = getAppsScriptUrl();
  if (!url) {
    console.error("[ledger-api] GOOGLE_APPS_SCRIPT_URL is missing or invalid");
    return failure(500, "CONFIG_ERROR", "Google Sheets API URL is not configured correctly");
  }

  const action = request.nextUrl.searchParams.get("action") || "get_dashboard";
  url.searchParams.set("action", action);
  return forwardToAppsScript(url, { method: "GET" }, action);
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) return failure(401, "UNAUTHORIZED", "Please sign in");
  if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
    console.error("[ledger-api] GOOGLE_APPS_SCRIPT_URL is not configured");
    return failure(500, "CONFIG_ERROR", "Google Sheets API is not configured");
  }
  const url = getAppsScriptUrl();
  if (!url) {
    console.error("[ledger-api] GOOGLE_APPS_SCRIPT_URL is invalid");
    return failure(500, "CONFIG_ERROR", "Google Sheets API URL is not configured correctly");
  }

  const body = await request.text();
  let action = "unknown";
  try {
    const payload: unknown = JSON.parse(body);
    if (payload && typeof payload === "object" && "action" in payload && typeof payload.action === "string") {
      action = payload.action;
    }
  } catch (error) {
    console.error("[ledger-api] Invalid JSON in ledger mutation request", {
      error: error instanceof Error ? error.message : "Invalid JSON",
    });
    return failure(400, "INVALID_REQUEST", "Invalid request data");
  }

  return forwardToAppsScript(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }, action);
}
