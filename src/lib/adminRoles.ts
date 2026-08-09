import { execute, queryOne } from "@/lib/db";
import { ApiError, requireAdmin } from "@/lib/api";
import type { PublicUser } from "@/lib/types";

/**
 * V2-A6 (#95): fine-grained admin permissions on top of the existing binary
 * `role === "admin"` check.
 *
 * Every admin surface still requires role="admin" FIRST (requireAdmin) — this
 * layer then narrows what that admin may touch. A user with role="admin" and
 * no admin_roles row is an implicit OWNER (today's single-admin reality keeps
 * working untouched). Enforcement lives at the API layer, never only the UI.
 */

export type AdminRole =
  | "owner"
  | "support"
  | "user_manager"
  | "content_manager"
  | "finance";

export type AdminPermission =
  | "users_read"
  | "users_write"
  | "billing_read"
  | "billing_write"
  | "profit_read"
  | "content_write"
  | "tickets"
  | "keys_write"
  | "roles_write";

const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[] | "all"> = {
  owner: "all",
  support: ["users_read", "tickets"],
  user_manager: ["users_read", "users_write", "billing_read", "tickets"],
  content_manager: ["content_write"],
  finance: ["users_read", "billing_read", "billing_write", "profit_read"],
};

export async function getAdminRole(userId: number): Promise<AdminRole> {
  const row = await queryOne<{ admin_role: string }>(
    "SELECT admin_role FROM admin_roles WHERE user_id = ?",
    [userId],
  );
  const role = row?.admin_role as AdminRole | undefined;
  return role && role in ROLE_PERMISSIONS ? role : "owner";
}

export function roleAllows(role: AdminRole, permission: AdminPermission): boolean {
  const grants = ROLE_PERMISSIONS[role];
  return grants === "all" || grants.includes(permission);
}

/**
 * Typed as Record<AdminPermission, true> on purpose: adding a permission to the
 * union without listing it here is a COMPILE error, so "all" can never quietly
 * expand to fewer permissions than an owner actually holds.
 */
const PERMISSION_KEYS: Record<AdminPermission, true> = {
  users_read: true,
  users_write: true,
  billing_read: true,
  billing_write: true,
  profit_read: true,
  content_write: true,
  tickets: true,
  keys_write: true,
  roles_write: true,
};

/**
 * Expand a role into the concrete permission list a client can reason about.
 * Server routes still gate with requireAdminWith — this exists so the admin UI
 * can hide what an admin cannot use, which is cosmetics, never enforcement.
 */
export function permissionsForRole(role: AdminRole): AdminPermission[] {
  const grants = ROLE_PERMISSIONS[role];
  const all = Object.keys(PERMISSION_KEYS) as AdminPermission[];
  return grants === "all" ? all : all.filter((p) => grants.includes(p));
}

/**
 * Gate an admin API on a specific permission. Throws the same errors
 * requireAdmin throws (handled by handleError) plus a 403-shaped one.
 */
export async function requireAdminWith(
  permission: AdminPermission,
): Promise<{ admin: PublicUser; adminRole: AdminRole }> {
  const admin = await requireAdmin();
  const adminRole = await getAdminRole(admin.id);
  if (!roleAllows(adminRole, permission)) {
    throw new ApiError(403, "ليست لديك صلاحية لهذا الإجراء.");
  }
  return { admin, adminRole };
}

/** Set (or clear with null) another admin's fine-grained role. Owner-only. */
export async function setAdminRole(
  targetUserId: number,
  role: AdminRole | null,
  grantedBy: number,
): Promise<void> {
  if (role === null) {
    await execute("DELETE FROM admin_roles WHERE user_id = ?", [targetUserId]);
  } else {
    const updated = await execute(
      "UPDATE admin_roles SET admin_role = ?, granted_by = ?, granted_at = ? WHERE user_id = ?",
      [role, grantedBy, Date.now(), targetUserId],
    );
    if (!updated.changes) {
      await execute(
        "INSERT INTO admin_roles (user_id, admin_role, granted_by, granted_at) VALUES (?, ?, ?, ?)",
        [targetUserId, role, grantedBy, Date.now()],
      );
    }
  }
  await auditAdminAction(grantedBy, "set_admin_role", String(targetUserId), role ?? "cleared");
}

export async function auditAdminAction(
  adminId: number,
  action: string,
  target?: string,
  detail?: string,
): Promise<void> {
  await execute(
    "INSERT INTO admin_audit (admin_id, action, target, detail, ts) VALUES (?, ?, ?, ?, ?)",
    [adminId, action, target ?? null, detail ?? null, Date.now()],
  );
}
