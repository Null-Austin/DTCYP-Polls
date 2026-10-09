import { route } from "@/lib/server/authz"

export const GET = route({ perm: "api:docs" }, ({ req }) => {
  const nonce = (req.headers.get("x-nonce") ?? "").replace(/[^A-Za-z0-9+/=_-]/g, "")
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DTCYP Polls API</title>
<link rel="stylesheet" href="/api/docs/assets/swagger-ui.css"></head>
<body><main id="swagger-ui"></main>
<script src="/api/docs/assets/swagger-ui-bundle.js" nonce="${nonce}"></script>
<script src="/api/docs/assets/swagger-ui-standalone-preset.js" nonce="${nonce}"></script>
<script nonce="${nonce}">window.onload=function(){window.ui=SwaggerUIBundle({url:'/api/v1/openapi.json',dom_id:'#swagger-ui',deepLinking:true,presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset],layout:'StandaloneLayout',persistAuthorization:false})}</script>
</body></html>`
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
})
