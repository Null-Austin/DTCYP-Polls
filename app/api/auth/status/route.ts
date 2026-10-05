import { route } from "@/lib/server/authz"
import { json } from "@/lib/server/http"
import { setupRequired } from "@/lib/server/accounts"

export const GET = route({ access: "public" }, ({ db }) => json({ setupRequired: setupRequired(db) }))
