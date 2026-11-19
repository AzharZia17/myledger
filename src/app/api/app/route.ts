import { NextRequest, NextResponse } from "next/server";

async function proxy(request: NextRequest) {
  const session = request.cookies.get("my-ledger-session")?.value;
  if (!session || session !== process.env.APP_ACCESS_PASSWORD) {
    return NextResponse.json({ success: false, data: null, error: { code: "UNAUTHORIZED", message: "Please sign in" } }, { status: 401 });
  }
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!url) return NextResponse.json({ success: false, data: null, error: { code: "CONFIG_ERROR", message: "Google Sheets API is not configured" } }, { status: 500 });
  try {
    const method = request.method;
    const body = method === "POST" ? await request.text() : undefined;
    const upstream = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body, redirect: "follow", cache: "no-store" });
    const text = await upstream.text();
    return new NextResponse(text, { status: upstream.ok ? 200 : 502, headers: { "Content-Type": "application/json" } });
  } catch {
    return NextResponse.json({ success: false, data: null, error: { code: "NETWORK_ERROR", message: "Unable to reach Google Sheets" } }, { status: 502 });
  }
}
export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action") || "get_dashboard";
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!url) return NextResponse.json({ success: false, data: null, error: { code: "CONFIG_ERROR", message: "Google Sheets API is not configured" } }, { status: 500 });
  const session = request.cookies.get("my-ledger-session")?.value;
  if (!session || session !== process.env.APP_ACCESS_PASSWORD) return NextResponse.json({ success: false, data: null, error: { code: "UNAUTHORIZED", message: "Please sign in" } }, { status: 401 });
  try {
    const separator = url.includes("?") ? "&" : "?";
    const upstream = await fetch(`${url}${separator}action=${encodeURIComponent(action)}`, { cache: "no-store", redirect: "follow" });
    return new NextResponse(await upstream.text(), { status: upstream.ok ? 200 : 502, headers: { "Content-Type": "application/json" } });
  } catch {
    return NextResponse.json({ success: false, data: null, error: { code: "NETWORK_ERROR", message: "Unable to reach Google Sheets" } }, { status: 502 });
  }
}
export async function POST(request: NextRequest) { return proxy(request); }
