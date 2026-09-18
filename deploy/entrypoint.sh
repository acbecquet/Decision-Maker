#!/bin/sh
set -eu

DB_PATH="${DATABASE_URL:-/data/app.db}"

if [ -n "${BUCKET_NAME:-}" ]; then
	echo "litestream: restoring $DB_PATH if it is missing and a backup exists"
	litestream restore -config /etc/litestream.yml -if-db-not-exists -if-replica-exists "$DB_PATH"
	echo "litestream: replicating $DB_PATH to bucket $BUCKET_NAME"
	exec litestream replicate -config /etc/litestream.yml -exec "node build"
else
	echo "litestream: BUCKET_NAME is not set, running without replication"
	exec node build
fi
