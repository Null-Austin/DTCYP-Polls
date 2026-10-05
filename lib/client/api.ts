let csrf = ""

export const setCsrf = (t: string) => {
  csrf = t
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

export async function api<T = Record<string, unknown>>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = opts.method ?? "GET"
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers["content-type"] = "application/json"
  if (method !== "GET") headers["x-csrf-token"] = csrf
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
      credentials: "same-origin",
    })
  } catch {
    throw new ApiError(0, "Network error. Check your connection and retry.")
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new ApiError(res.status, typeof data.error === "string" ? data.error : "Something went wrong", data)
  if (typeof data.csrf === "string") csrf = data.csrf
  return data as T
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong")

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "-")
