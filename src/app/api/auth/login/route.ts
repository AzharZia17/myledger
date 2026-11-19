import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { password } = await request.json();
  const expected = process.env.APP_ACCESS_PASSWORD;
  if (!expected) return NextResponse.json({ success: false, error: { code: "CONFIG_ERROR", message: "APP_ACCESS_PASSWORD is not configured" } }, { status: 500 });
  if (typeof password !== "string" || password !== expected) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Incorrect password" } }, { status: 401 });
  const response = NextResponse.json({ success: true, data: { authenticated: true }, error: null });
  response.cookies.set("my-ledger-session", expected, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return response;
}
