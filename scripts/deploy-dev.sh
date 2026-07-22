#!/usr/bin/env bash
# Deploy the LATEST channel -> Vercel project job-operations-hub-dev (the Development app).
# Deploys the tip of `main` from a clean detached worktree - never the working tree.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
SHA=$(git -C "$REPO_ROOT" rev-parse --short refs/heads/main)
DIR=$(mktemp -d /tmp/deploy-dev-XXXXXX)
LOG=$(mktemp /tmp/deploy-dev-log-XXXXXX)
trap 'git -C "$REPO_ROOT" worktree remove --force "$DIR" 2>/dev/null || true' EXIT

git -C "$REPO_ROOT" worktree add --detach "$DIR" refs/heads/main >/dev/null
mkdir -p "$DIR/.vercel"
cat > "$DIR/.vercel/project.json" <<'JSON'
{"projectId":"prj_ipE9qI1oImGClfCFbBtdUTIYJdE6","orgId":"team_qxmdijYqVGdIc2V8sv1NnV0f","projectName":"job-operations-hub-dev"}
JSON

echo "Deploying main ($SHA) -> job-operations-hub-dev [DEVELOPMENT]"
(cd "$DIR" && npx vercel deploy --prod --yes --scope uptiq) >"$LOG" 2>&1 || { tail -20 "$LOG"; exit 1; }
grep -oE 'https://job-operations-hub-dev-[a-z0-9]+-uptiq\.vercel\.app' "$LOG" | tail -1 || true

sleep 5
BUNDLE=$(curl -s https://job-operations-hub-dev.vercel.app/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
echo "Live dev bundle: ${BUNDLE:-<not found>}"
