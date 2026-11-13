#!/bin/sh
set -e
envsubst < /etc/keepalived/keepalived.conf.template > /etc/keepalived/keepalived.conf
envsubst < /etc/keepalived/track_script.sh > /etc/keepalived/track_script_resolved.sh
chmod +x /etc/keepalived/track_script_resolved.sh
# A stale pid file left in the writable layer by an unclean stop (kill, power
# loss) makes keepalived exit with "daemon is already running" on every restart.
# This container runs a single keepalived (PID 1 via exec), so none can be live.
rm -f /run/keepalived/*.pid /run/keepalived.pid /run/vrrp.pid /run/checkers.pid
exec keepalived --dont-fork --log-console
