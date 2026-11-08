#!/usr/bin/env bash
# apps/<app>/ の中身だけを gas-<app> ブランチの直下に置いてプッシュする（履歴は残す）
set -euo pipefail
cd "$(dirname "$0")/.."
root="$(pwd)"
src_sha="$(git rev-parse --short HEAD)"
tmp="${RUNNER_TEMP:-$(mktemp -d)}"

for app in applicant admin; do
  branch="gas-$app"
  dir="$tmp/$branch"
  rm -rf "$dir"
  if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
    git fetch -q origin "$branch"
    git worktree add -q -B "$branch" "$dir" "origin/$branch"
  else
    git worktree add -q --detach "$dir"
    git -C "$dir" checkout -q --orphan "$branch"
  fi
  find "$dir" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  cp -R "apps/$app/." "$dir/"
  git -C "$dir" add -A
  if git -C "$dir" diff --cached --quiet; then
    echo "$branch: 変更なし"
  else
    git -C "$dir" commit -q -m "Sync from main ($src_sha)"
    git -C "$dir" push -q origin "$branch"
    echo "$branch: 更新しました"
  fi
  git worktree remove --force "$dir"
done
