#!/usr/bin/env bash
#
# One-time setup for Davinci's collaborator copy of Virtual Sound Stage.
# Connects this folder to the GitHub repo and sets a LOCAL git identity
# (only affects THIS repo — never touches your global git config).
#
set -e

REPO_URL="https://github.com/Luxlaxa/virtual-sound-stage.git"

echo "=============================================="
echo " Virtual Sound Stage — Collaborator Setup"
echo "=============================================="
echo

# 1. Verify / install Git LFS ---------------------------------------------
echo "[1/5] Checking Git LFS..."
if ! command -v git-lfs >/dev/null 2>&1; then
    echo "  Git LFS is NOT installed. The 3D models & splats need it."
    echo "  Install it with:"
    echo "    macOS:   brew install git-lfs"
    echo "    Windows: download from https://git-lfs.com"
    echo "    Linux:   sudo apt install git-lfs"
    echo
    echo "  Then re-run this script."
    exit 1
fi
git lfs install
echo "  Git LFS OK."
echo

# 2. Init git if needed ----------------------------------------------------
echo "[2/5] Setting up git repo..."
if [ ! -d .git ]; then
    git init
    git remote add origin "$REPO_URL"
    echo "  Initialized and added remote: $REPO_URL"
else
    if ! git remote | grep -q origin; then
        git remote add origin "$REPO_URL"
    fi
    echo "  Git repo already exists. Remote 'origin' set to: $(git remote get-url origin)"
fi
echo

# 3. Set LOCAL identity ----------------------------------------------------
echo "[3/5] Setting YOUR git identity (local to this repo only)..."
read -r -p "  Your name (e.g. Davinci): " GIT_NAME
read -r -p "  Your GitHub email: " GIT_EMAIL
git config --local user.name "$GIT_NAME"
git config --local user.email "$GIT_EMAIL"
echo "  Local identity set: $GIT_NAME <$GIT_EMAIL>"
echo "  (Your global git config was NOT changed.)"
echo

# 4. Fetch latest ----------------------------------------------------------
echo "[4/5] Fetching latest from GitHub..."
git fetch origin
# Make sure local main tracks origin/main without clobbering local files
if git show-ref --verify --quiet refs/heads/main; then
    git branch --set-upstream-to=origin/main main 2>/dev/null || true
else
    git checkout -b main --track origin/main 2>/dev/null || git checkout main 2>/dev/null || true
fi
echo

# 5. Pull LFS assets -------------------------------------------------------
echo "[5/5] Pulling LFS assets (3D models, splats)..."
git lfs pull || echo "  (run 'git lfs pull' manually if this step was skipped)"
echo

echo "=============================================="
echo " Done! You're connected as $GIT_NAME."
echo
echo " Run the viewer:    npx serve -l 8080 -s ."
echo " Get updates:       git pull origin main && git lfs pull"
echo " Propose a change:  see README-COLLAB.md section 3"
echo "=============================================="
