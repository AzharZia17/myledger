import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname === "/login"
    || pathname.startsWith("/api/auth/login")
    || pathname.startsWith("/_next")
    || pathname.startsWith("/favicon")
    || pathname.startsWith("/icon")
    || pathname.startsWith("/apple-icon")
    || pathname === "/sw.js"
    || pathname === "/manifest.webmanifest"
    || pathname === "/icon.svg"
    || pathname === "/offline.html"
  ) return NextResponse.next();
  const session = request.cookies.get("my-ledger-session")?.value;
  if (!session || session !== process.env.APP_ACCESS_PASSWORD) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ success: false, data: null, error: { code: "UNAUTHORIZED", message: "Please sign in" } }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
