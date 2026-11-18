#!/bin/bash
set -euo pipefail
umask 077
exec 9>/run/lms-backup.lock
flock -n 9 || exit 0
base=/var/backups/lms
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$base/$stamp"
mkdir -p "$target"
runuser -u postgres -- pg_dump --format=custom lms > "$target/database.dump"
cp -a /etc/lms "$target/config"
# Immutable uploads allow complete daily snapshots without duplicate file data.
cp -al /var/lib/lms/storage "$target/storage"
sha256sum "$target/database.dump" > "$target/database.sha256"
touch "$target/complete"
# Only dated directories inside this fixed backup location may be pruned.
find "$base" -mindepth 1 -maxdepth 1 -type d -name '????????T??????Z' -mtime +7 -exec rm -rf -- {} +
echo "Daily database and storage snapshot completed: $stamp"
