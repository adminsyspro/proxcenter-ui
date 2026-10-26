UPDATE audit_logs
SET details = jsonb_set(details, '{request,openaiKey}', '"[redacted]"'::jsonb)
WHERE jsonb_typeof(details->'request') = 'object'
  AND details->'request' ? 'openaiKey'
  AND coalesce(details->'request'->>'openaiKey', '') NOT IN ('', '[redacted]');

UPDATE audit_logs
SET details = jsonb_set(details, '{request,anthropicKey}', '"[redacted]"'::jsonb)
WHERE jsonb_typeof(details->'request') = 'object'
  AND details->'request' ? 'anthropicKey'
  AND coalesce(details->'request'->>'anthropicKey', '') NOT IN ('', '[redacted]');

UPDATE audit_logs
SET details = jsonb_set(details, '{openaiKey}', '"[redacted]"'::jsonb)
WHERE jsonb_typeof(details) = 'object'
  AND details ? 'openaiKey'
  AND coalesce(details->>'openaiKey', '') NOT IN ('', '[redacted]');

UPDATE audit_logs
SET details = jsonb_set(details, '{anthropicKey}', '"[redacted]"'::jsonb)
WHERE jsonb_typeof(details) = 'object'
  AND details ? 'anthropicKey'
  AND coalesce(details->>'anthropicKey', '') NOT IN ('', '[redacted]');
