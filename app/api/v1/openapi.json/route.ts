import { route } from "@/lib/server/authz"
import { json } from "@/lib/server/http"
import { OPENAPI } from "@/lib/server/openapi"

export const GET = route({ perm: "api:docs" }, () => json(OPENAPI))
