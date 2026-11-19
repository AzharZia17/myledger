import { NextResponse } from "next/server";
export async function POST() {
  const response = NextResponse.json({ success: true, data: null, error: null });
  response.cookies.delete("my-ledger-session");
  return response;
}
