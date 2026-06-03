-- Role-level default scope (issue #383).
-- Custom roles can carry a default resource scope inherited by every
-- assignment whose scope_type is 'inherit'. Shape: [{ scopeType, scopeTarget }].
ALTER TABLE "rbac_roles" ADD COLUMN "default_scopes" JSONB;

-- Convert existing SSO-managed assignments from explicit global to inherit so
-- they follow the role's default scope automatically. Behavior-neutral today
-- (no role has a default scope yet, so inherit resolves to global) and removes
-- a duplicate-row hazard once the SSO login sync keys on the inherit row.
-- The underscore is escaped because it is a single-character wildcard in LIKE.
UPDATE "rbac_user_roles"
   SET "scope_type" = 'inherit', "scope_target" = NULL
 WHERE "scope_type" = 'global'
   AND ("id" LIKE 'ldap\_%' ESCAPE '\' OR "id" LIKE 'oidc\_%' ESCAPE '\');
