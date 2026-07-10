#!/bin/sh
# Keepalived track_script: all 4 checks must pass for the node to hold the VIP.
# Expanded by entrypoint-keepalived.sh (envsubst) to resolve ${NODE_IP}.

# 1. nginx up (TLS entry point)
wget -q --spider --timeout=3 http://127.0.0.1:80/ || exit 1

# 2. Frontend up
wget -q --spider --timeout=3 http://127.0.0.1:3000/api/health || exit 1

# 3. Orchestrator up
wget -q --spider --timeout=3 http://127.0.0.1:8080/api/v1/health || exit 1

# 4. DB primary reachable via Patroni REST (bound to NODE_IP, not 127.0.0.1)
wget -q --spider --timeout=3 http://${NODE_IP}:8008/primary || exit 1

exit 0
