export const OPENAPI = {
  openapi: "3.1.0",
  info: { title: "DTCYP Polls API", version: "1.0.0", description: "Cookie-session and bot-token API. Write requests with cookie authentication require CSRF and same-origin headers. Rate limit: 120 requests/minute per bot account by default; login/setup endpoints have separate in-memory limits." },
  servers: [{ url: "/" }],
  security: [{ sessionCookie: [] }, { bearerAuth: [] }],
  paths: {
    "/api/v1/openapi.json": {
      get: { summary: "Retrieve the OpenAPI 3.1 specification", responses: { "200": { description: "OpenAPI document" }, "401": { description: "Not authenticated" }, "403": { description: "Missing api:docs permission" } } },
    },
    "/api/v1/me/permissions": {
      get: { summary: "Return this account's effective permissions and resource scopes", responses: { "200": { description: "Effective permissions and roles" }, "401": { description: "Not authenticated" } } },
    },
    "/api/v1/polls/{pollid}/responses": {
      get: {
        summary: "List poll responses. Returns an empty list when the caller can read the poll but lacks responses:read.",
        parameters: [
          { name: "pollid", in: "path", required: true, schema: { type: "string" } },
          { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: {
          "200": { description: "Responses or an empty list when response access is not granted", content: { "application/json": { schema: { $ref: "#/components/schemas/ResponsesPage" } } } },
          "401": { description: "Not authenticated" }, "404": { description: "Poll does not exist or is not visible to this account" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "DTP token" },
      sessionCookie: { type: "apiKey", in: "cookie", name: "sid", description: "Production cookie name is __Host-sid; same-origin writes also require X-CSRF-Token." },
    },
    schemas: {
      Error: { type: "object", required: ["error"], properties: { error: { type: "string" }, code: { type: "string" } } },
      ResponsesPage: {
        type: "object", required: ["responses", "page", "pageSize", "total"],
        properties: {
          responses: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, status: { type: "string", enum: ["verified", "unverified", "accepted"] }, submittedAt: { type: "string", format: "date-time" }, deviceClass: { type: "string", enum: ["mobile", "desktop"] }, language: { type: "string", minLength: 2, maxLength: 2 }, answers: { type: "array", items: { type: "object" } } } } },
          page: { type: "integer" }, pageSize: { type: "integer", const: 100 }, total: { type: "integer" },
        },
      },
    },
  },
} as const
