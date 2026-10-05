import { route } from "@/lib/server/authz"
import { exact, HttpError, json, rateLimit, readJson } from "@/lib/server/http"
import { deviceClass, languageCode, parseAnswers, submitResponse } from "@/lib/server/polls"

export const POST = route<{ pollid: string }>({ access: "public" }, async ({ req, db, params }) => {
  const body = await readJson(req, 32 * 1024)
  exact(body, ["token", "answers"])
  const token = typeof body.token === "string" ? body.token : ""
  if (!rateLimit(`submit:${token.slice(0, 64)}`, 20, 60_000)) throw new HttpError(429, "Too many attempts")
  const answers = parseAnswers(body.answers)
  // UA and Accept-Language are reduced to coarse classes and then dropped.
  submitResponse(db, params.pollid, token, answers, {
    device: deviceClass(req.headers.get("user-agent")),
    language: languageCode(req.headers.get("accept-language")),
  })
  return json({ ok: true }, 201)
})
