import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  if (request.nextUrl.pathname === "/api/health") {
    return NextResponse.next();
  }
  const expected = process.env.EDITOR_SHARED_KEY;
  if (!expected) {
    return NextResponse.json({ error: "Server misconfiguration: EDITOR_SHARED_KEY" }, { status: 500 });
  }
  const key = request.headers.get("x-editor-key");
  if (key !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
