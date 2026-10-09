// Single source of truth for permissions. Keep descriptions short: the UI shows them as tooltips.
export const PERMISSIONS = {
  "polls:create": "Create new polls",
  "polls:read": "View polls",
  "polls:edit": "Edit poll content, status and schedule",
  "polls:delete": "Move polls to the trash and delete them permanently",
  "polls:publish": "Open, close, archive and restore polls",
  "polls:share": "Share polls with other accounts",

  "groups:create": "Create distribution groups (link batches)",
  "groups:read": "View distribution groups",
  "groups:edit": "Rename, reorder, merge, split, duplicate and archive groups",
  "groups:delete": "Delete groups",

  "urls:create": "Generate poll URLs",
  "urls:read": "View poll URLs and their state",
  "urls:edit": "Edit titles and notes, enable or disable, regenerate and move URLs",
  "urls:delete": "Delete or revoke URLs",
  "urls:export": "Copy and download URLs (CSV or text)",

  "responses:read": "Read poll responses and results",
  "responses:export": "Export responses",
  "responses:delete": "Delete responses",

  "tokens:create": "Create API tokens (bot accounts)",
  "tokens:read": "List API tokens (never the secrets)",
  "tokens:revoke": "Revoke, rotate and delete API tokens",

  "users:read": "List accounts",
  "users:create": "Create accounts",
  "users:edit": "Edit account details",
  "users:disable": "Disable and enable accounts",
  "users:delete": "Delete accounts",

  "role:read": "View roles",
  "role:create": "Create roles",
  "role:edit": "Edit roles (name, colour, permissions)",
  "role:delete": "Delete roles",
  "role:assign": "Give and take roles to or from accounts",
  "role:admin": "Change role levels and reorder roles",

  "audit:read": "View the audit log",
  "audit:export": "Export the audit log",

  "api:docs": "View the API documentation",

  "admin:settings": "Change site settings",
  "admin:branding": "Change the site icon and name",
  "admin:export": "Export all site data",
  "admin:backups": "Create, download and restore backups",
  "admin:webhooks": "Manage webhooks",
  "admin:security": "See security overview and revoke sessions",
  "admin:system": "See system health and maintenance mode",
  "admin:logs": "See operational logs (jobs, webhook deliveries)",
} as const satisfies Record<string, string>

export type Permission = keyof typeof PERMISSIONS
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]
export const isPermission = (p: unknown): p is Permission => typeof p === "string" && Object.hasOwn(PERMISSIONS, p)
export const groupOf = (p: string) => p.split(":")[0]

export const MAX_LEVEL = 255

// Permissions that a poll share confers on that one poll (independent of roles).
export const SHARE_VIEW: Permission[] = ["polls:read", "responses:read", "responses:export"]
export const SHARE_EDIT: Permission[] = [
  ...SHARE_VIEW,
  "polls:edit",
  "polls:publish",
  "groups:create",
  "groups:read",
  "groups:edit",
  "urls:create",
  "urls:read",
  "urls:edit",
  "urls:export",
]
