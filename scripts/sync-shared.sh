#!/usr/bin/env bash
# shared/ の共通コードを申請者用・管理者用の両プロジェクトにコピーする
set -euo pipefail
cd "$(dirname "$0")/.."
for app in apps/applicant apps/admin; do
  cp shared/*.gs "$app/"
  echo "synced -> $app"
done
