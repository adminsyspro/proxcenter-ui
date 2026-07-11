#!/bin/sh
# Keepalived track_script: all 3 checks must pass for the node to hold the VIP.
# Expanded by entrypoint-keepalived.sh (envsubst) to resolve ${NODE_IP}.

# 1. Frontend up + DB reachable via HAProxy (anti-split-brain)
# In a minority partition, HAProxy has no healthy backend,
# so the frontend's SELECT 1 fails and returns db:unreachable.
HEALTH=$(wget -q -O- --timeout=3 http://127.0.0.1:3000/api/health 2>/dev/null)
echo "$HEALTH" | grep -q '"db":"reachable"' || exit 1

# 2. Orchestrator up
wget -q -O /dev/null --timeout=3 http://127.0.0.1:8080/api/v1/health || exit 1

# 3. Patroni running on this node
wget -q -O /dev/null --timeout=3 http://${NODE_IP}:8008/health || exit 1

exit 0
