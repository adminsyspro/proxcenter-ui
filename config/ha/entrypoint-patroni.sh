#!/bin/sh
set -e
envsubst < /etc/patroni/patroni.yml > /tmp/patroni.yml
exec patroni /tmp/patroni.yml
