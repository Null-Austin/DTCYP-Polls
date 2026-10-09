import fs from "node:fs"
import path from "node:path"
import { route } from "@/lib/server/authz"
import { HttpError } from "@/lib/server/http"

const FILES = new Set(["swagger-ui.css", "swagger-ui-bundle.js", "swagger-ui-standalone-preset.js"])

export const GET = route<{ file: string }>({ perm: "api:docs" }, ({ params }) => {
  if (!FILES.has(params.file)) throw new HttpError(404, "Not found")
  const filePath = path.join(process.cwd(), "node_modules", "swagger-ui-dist", params.file)
  const body = fs.readFileSync(filePath)
  const type = params.file.endsWith(".css") ? "text/css" : "application/javascript"
  return new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } })
})
