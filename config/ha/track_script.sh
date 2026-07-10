#!/bin/sh
# Keepalived track_script: all 4 checks must pass for the node to hold the VIP.
# Expanded by entrypoint-keepalived.sh (envsubst) to resolve ${NODE_IP}.

# 1. nginx up (TLS entry point)
wget -q --spider --timeout=3 http://127.0.0.1:80/healthz || exit 1

# 2. Frontend up
wget -q --spider --timeout=3 http://127.0.0.1:3000/api/health || exit 1

# 3. Orchestrator up
wget -q --spider --timeout=3 http://127.0.0.1:8080/api/v1/health || exit 1

# 4. Patroni healthy on this node (running, not necessarily primary)
wget -q --spider --timeout=3 http://${NODE_IP}:8008/health || exit 1

exit 0
