import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "admin-roles-")), "test.db");
delete process.env.DATABASE_URL;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let roles: any;

before(async () => {
  db = await import("@/lib/db");
  roles = await import("@/lib/adminRoles");
  await db.initDb();
  await db.execute(
    "INSERT INTO users (id, email, password_hash, role, status) VALUES (20, 'boss@t.local', 'x', 'admin', 'active')",
  );
  await db.execute(
    "INSERT INTO users (id, email, password_hash, role, status) VALUES (21, 'helper@t.local', 'x', 'admin', 'active')",
  );
});

describe("admin role permission matrix", () => {
  it("an admin with no role row is an implicit owner (today keeps working)", async () => {
    assert.equal(await roles.getAdminRole(20), "owner");
    assert.equal(roles.roleAllows("owner", "billing_write"), true);
    assert.equal(roles.roleAllows("owner", "roles_write"), true);
  });

  it("support can read users and handle tickets — never money or keys", () => {
    assert.equal(roles.roleAllows("support", "users_read"), true);
    assert.equal(roles.roleAllows("support", "tickets"), true);
    assert.equal(roles.roleAllows("support", "billing_write"), false);
    assert.equal(roles.roleAllows("support", "keys_write"), false);
    assert.equal(roles.roleAllows("support", "profit_read"), false);
  });

  it("finance sees and moves money but cannot manage roles or content", () => {
    assert.equal(roles.roleAllows("finance", "billing_write"), true);
    assert.equal(roles.roleAllows("finance", "profit_read"), true);
    assert.equal(roles.roleAllows("finance", "roles_write"), false);
    assert.equal(roles.roleAllows("finance", "content_write"), false);
  });

  it("assigning and clearing a role persists and audits", async () => {
    await roles.setAdminRole(21, "support", 20);
    assert.equal(await roles.getAdminRole(21), "support");

    await roles.setAdminRole(21, "finance", 20);
    assert.equal(await roles.getAdminRole(21), "finance");

    await roles.setAdminRole(21, null, 20);
    assert.equal(await roles.getAdminRole(21), "owner", "cleared → implicit owner");

    const audit = await db.query(
      "SELECT action, target, detail FROM admin_audit WHERE admin_id = 20 ORDER BY id",
    );
    assert.equal(audit.length, 3);
    assert.equal(audit[0].action, "set_admin_role");
    assert.equal(audit[2].detail, "cleared");
  });
});
