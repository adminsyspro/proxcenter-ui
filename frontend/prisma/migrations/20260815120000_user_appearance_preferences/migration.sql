-- Per-user appearance preferences (issue #696).
--
-- The colour scheme, display mode and the rest of the Appearance tab were only
-- ever written to the `materio-mui-next-demo` browser cookie, so a browser
-- configured to clear cookies on exit sent the user back to the default
-- ProxCenter orange on the next visit. This table gives those settings a
-- server-side home, keyed per tenant and per user like dashboard layouts.

CREATE TABLE IF NOT EXISTS "user_preferences" (
    "tenant_id"  TEXT NOT NULL DEFAULT 'default',
    "user_id"    TEXT NOT NULL,
    "appearance" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("tenant_id", "user_id")
);
