#!/bin/sh
set -e
envsubst '${PEER1_IP} ${PEER2_IP} ${PEER3_IP}' < /usr/local/etc/haproxy/haproxy.cfg.template > /usr/local/etc/haproxy/haproxy.cfg
exec haproxy -f /usr/local/etc/haproxy/haproxy.cfg
