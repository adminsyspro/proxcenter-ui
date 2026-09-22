-- The group -> role mapping becomes an ORDERED list on both providers, and OIDC
-- gains a strategy telling how several matching rows combine (issue #992).
--
-- jsonb does not keep an object's key order (it sorts by key length, then
-- bytewise), so the row order an admin typed in the SSO form could never
-- survive a save. Storing a JSON array instead makes the order durable, which
-- is what "first match wins" needs in order to mean anything.

ALTER TABLE "oidc_config" ADD COLUMN "group_mapping_strategy" TEXT NOT NULL DEFAULT 'first_match';

ALTER TABLE "oidc_config" ALTER COLUMN "group_role_mapping" SET DEFAULT '[]';
ALTER TABLE "ldap_config" ALTER COLUMN "group_role_mapping" SET DEFAULT '[]';

-- Freeze every legacy flat object into a list. The order it was entered in is
-- already lost at this point, so the rows come out alphabetically: a stable,
-- predictable starting point the admin can then reorder.
UPDATE "oidc_config"
SET "group_role_mapping" = COALESCE(
  (
    SELECT jsonb_agg(
      jsonb_build_object('group', entry.key, 'tenant', 'default', 'vdc', '', 'role', entry.value)
      ORDER BY entry.key
    )
    FROM jsonb_each_text("group_role_mapping") AS entry
    WHERE entry.value <> ''
  ),
  '[]'::jsonb
)
WHERE jsonb_typeof("group_role_mapping") = 'object';

UPDATE "ldap_config"
SET "group_role_mapping" = COALESCE(
  (
    SELECT jsonb_agg(
      jsonb_build_object('group', entry.key, 'role', entry.value)
      ORDER BY entry.key
    )
    FROM jsonb_each_text("group_role_mapping") AS entry
    WHERE entry.value <> ''
  ),
  '[]'::jsonb
)
WHERE jsonb_typeof("group_role_mapping") = 'object';
