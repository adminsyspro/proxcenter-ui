-- XCP-ng connections now carry a mode in sub_type: 'xo' (Xen Orchestra REST, the
-- only mode until now) or 'xapi' (direct pool access, required for warm migration).
UPDATE "Connection" SET "sub_type" = 'xo' WHERE "type" = 'xcpng' AND "sub_type" IS NULL;
