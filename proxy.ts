import { NextResponse, type NextRequest } from "next/server"

export function proxy(req: NextRequest) {
  const prod = process.env.NODE_ENV === "production"
  const { pathname } = req.nextUrl

  // Debug pages are dev-only.
  if (prod && (pathname === "/test" || pathname.startsWith("/test/"))) return new NextResponse(null, { status: 404 })

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${prod ? "" : " 'unsafe-eval'"}`,
    prod ? `style-src 'self' 'nonce-${nonce}'` : "style-src 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(prod ? ["upgrade-insecure-requests"] : []),
  ].join("; ")

  const headers = new Headers(req.headers)
  headers.set("x-nonce", nonce)
  headers.set("Content-Security-Policy", csp)
  const res = NextResponse.next({ request: { headers } })
  res.headers.set("Content-Security-Policy", csp)
  res.headers.set("X-Content-Type-Options", "nosniff")
  res.headers.set("X-Frame-Options", "DENY")
  res.headers.set("Referrer-Policy", "no-referrer")
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()")
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin")
  if (prod) res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
  return res
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }],
}
