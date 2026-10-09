import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"

export type RequestContext = { requestId: string; ip: string | null; userAgent: string | null }

const als = new AsyncLocalStorage<RequestContext>()

// Reverse-proxy header that carries the real client address (e.g. "x-forwarded-for" or "x-real-ip").
// Never trusted unless the operator names it, so a plain deployment sees no client addresses at all.
export function clientIp(req: Request): string | null {
  const name = (process.env.CLIENT_IP_HEADER || "").toLowerCase()
  if (!name) return null
  const raw = req.headers.get(name)
  if (!raw) return null
  const first = raw.split(",")[0].trim().slice(0, 64)
  return /^[0-9a-fA-F:.]+$/.test(first) ? first : null
}

export function runWithContext<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  const id = req.headers.get("x-request-id")
  return als.run(
    {
      requestId: id && /^[A-Za-z0-9._-]{8,64}$/.test(id) ? id : randomUUID(),
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null,
    },
    fn,
  )
}

export const requestContext = () => als.getStore()
