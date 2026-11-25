#!/bin/sh
set -e
envsubst < /etc/keepalived/keepalived.conf.template > /etc/keepalived/keepalived.conf
# The template lists the three nodes as unicast peers, this one included. A
# node is not its own peer: keepalived 2.3 answers the adverts it sends to
# itself with one warning per second for as long as it holds the VIP.
if [ -n "${NODE_IP:-}" ]; then
  awk -v self="$NODE_IP" '
    /unicast_peer[ \t]*\{/ { peers = 1; print; next }
    peers && /\}/ { peers = 0 }
    peers && $1 == self { next }
    { print }
  ' /etc/keepalived/keepalived.conf > /etc/keepalived/keepalived.conf.tmp
  mv /etc/keepalived/keepalived.conf.tmp /etc/keepalived/keepalived.conf
fi
envsubst < /etc/keepalived/track_script.sh > /etc/keepalived/track_script_resolved.sh
chmod +x /etc/keepalived/track_script_resolved.sh
# A stale pid file left in the writable layer by an unclean stop (kill, power
# loss) makes keepalived exit with "daemon is already running" on every restart.
# This container runs a single keepalived (PID 1 via exec), so none can be live.
rm -f /run/keepalived/*.pid /run/keepalived.pid /run/vrrp.pid /run/checkers.pid
exec keepalived --dont-fork --log-console
