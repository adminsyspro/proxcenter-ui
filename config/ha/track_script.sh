#!/bin/sh
# Keepalived track_script: all 3 checks must pass for the node to hold the VIP.
# Expanded by entrypoint-keepalived.sh (envsubst) to resolve ${NODE_IP}.
# Do NOT use shell variables here: envsubst would replace them with empty strings.

# 1. Frontend READINESS: /api/health answers 503 when the DB is unreachable
#    through HAProxy (anti-split-brain). In a minority partition HAProxy has
#    no healthy backend, the frontend's SELECT 1 fails, wget exits non-zero
#    on the 503 and the node sheds the VIP. Container healthchecks use the
#    liveness endpoint (/api/health/live) instead; this script is the only
#    probe that must track readiness.
wget -q -O /dev/null --timeout=3 http://127.0.0.1:3000/api/health || exit 1

# 2. Orchestrator up
wget -q -O /dev/null --timeout=3 http://127.0.0.1:8080/api/v1/health || exit 1

# 3. Patroni running on this node
wget -q -O /dev/null --timeout=3 http://${NODE_IP}:8008/health || exit 1

exit 0
