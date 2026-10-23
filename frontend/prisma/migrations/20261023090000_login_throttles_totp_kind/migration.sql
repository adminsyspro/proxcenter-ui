-- The always-on second factor floor (lib/auth/totpThrottle.ts) counts wrong
-- TOTP codes in this table under kind 'totp', keyed by user id.
ALTER TABLE "login_throttles" DROP CONSTRAINT "login_throttles_kind_check";
ALTER TABLE "login_throttles"
  ADD CONSTRAINT "login_throttles_kind_check" CHECK ("kind" IN ('account', 'ip', 'totp'));
