import { route } from "@/lib/server/authz"
import { json } from "@/lib/server/http"
import { publicUser } from "@/lib/server/accounts"

export const GET = route({ access: "user", allowMustChange: true }, ({ session }) =>
  json({ user: publicUser(session!.user), csrf: session!.csrf }),
)
