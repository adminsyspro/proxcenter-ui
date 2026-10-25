-- At most one certificate may be active at a time. A partial unique index makes
-- the two-active-rows state impossible rather than merely unlikely, and turns a
-- concurrent activation into a loud error instead of a silently flapping listener.
CREATE UNIQUE INDEX "tls_certificates_single_active"
  ON "tls_certificates" ("is_active")
  WHERE "is_active";
