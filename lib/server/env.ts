import path from "node:path"

const DEV_SECRET = "dev-only-insecure-session-secret-change-me"

const int = (v: string | undefined, d: number) => {
  const n = Number.parseInt(v ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : d
}

export const isProd = () => process.env.NODE_ENV === "production"

export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET
  if (isProd() && (!s || s.length < 32 || s === DEV_SECRET)) {
    throw new Error("SESSION_SECRET must be set to a random string of 32+ characters in production")
  }
  return s || DEV_SECRET
}

export const env = {
  databasePath: () => path.resolve(process.env.DATABASE_PATH || "data/polls.db"),
  publicBaseUrl: () => (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
  setupToken: () => process.env.SETUP_TOKEN || "",
  retentionDays: () => int(process.env.RESPONSE_RETENTION_DAYS, 365),
  idleMinutes: () => int(process.env.SESSION_IDLE_MINUTES, 30),
  maxHours: () => int(process.env.SESSION_MAX_HOURS, 12),
}
