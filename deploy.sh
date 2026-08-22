#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
source .deploy.conf

lftp -u "$FTP_USER","$FTP_PASS" "$FTP_HOST" <<EOF
set ftp:ssl-allow no
mirror --reverse --verbose --delete \
  --exclude-glob .DS_Store \
  site/ "$FTP_REMOTE_DIR/"
bye
EOF

echo "Deploy done: $(date '+%Y-%m-%d %H:%M:%S')"
