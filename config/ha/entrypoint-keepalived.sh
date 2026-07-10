#!/bin/sh
set -e
envsubst < /etc/keepalived/keepalived.conf.template > /etc/keepalived/keepalived.conf
envsubst < /etc/keepalived/track_script.sh > /etc/keepalived/track_script_resolved.sh
chmod +x /etc/keepalived/track_script_resolved.sh
exec keepalived --dont-fork --log-console
