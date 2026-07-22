#!/usr/bin/env bash
# Deploy the STABLE channel -> Vercel project job-operations-hub (PRODUCTION, embedded in Uptiq).
# Deploys the tip of `stable` from a clean detached worktree - never the working tree.
# Move the stable branch/tag first (only on Tyler's explicit stable-mark), then run this.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
SHA=$(git -C "$REPO_ROOT" rev-parse --short refs/heads/stable)
DIR=$(mktemp -d /tmp/deploy-prod-XXXXXX)
LOG=$(mktemp /tmp/deploy-prod-log-XXXXXX)
trap 'git -C "$REPO_ROOT" worktree remove --force "$DIR" 2>/dev/null || true' EXIT

git -C "$REPO_ROOT" worktree add --detach "$DIR" refs/heads/stable >/dev/null
mkdir -p "$DIR/.vercel"
cat > "$DIR/.vercel/project.json" <<'JSON'
{"projectId":"prj_RehlTMkU9tDgNBY2bGn4oMr7gEtT","orgId":"team_qxmdijYqVGdIc2V8sv1NnV0f","projectName":"job-operations-hub"}
JSON

echo "Deploying stable ($SHA) -> job-operations-hub [PRODUCTION]"
(cd "$DIR" && npx vercel deploy --prod --yes --scope uptiq) >"$LOG" 2>&1 || { tail -20 "$LOG"; exit 1; }
grep -oE 'https://job-operations-hub-[a-z0-9]+-uptiq\.vercel\.app' "$LOG" | tail -1 || true

sleep 5
BUNDLE=$(curl -s https://job-operations-hub.vercel.app/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
echo "Live prod bundle: ${BUNDLE:-<not found>} - verify it matches the stable build before walking away."
