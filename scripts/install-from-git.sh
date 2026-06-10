#!/usr/bin/env bash
#
# install-from-git.sh — install the smart-data-dico CLI from git, without
# pulling the package itself from the npm registry. (Dependencies are still
# fetched from whatever npm registry / corporate proxy `npm` is configured to
# use — only the package itself comes from git.)
#
# Why a script and not `npm i git+<url>`? The build artifacts (backend/dist,
# frontend/dist) are git-ignored and the package has no `prepare` script, so a
# bare git install ships no runnable CLI. This script clones, builds, and then
# packs a self-contained tarball you can install globally (or copy to an
# air-gapped machine and install there — it needs no node_modules at runtime).
#
# Usage:
#   scripts/install-from-git.sh [-r REF] [-u REPO_URL] [-d WORKDIR] [--pack-only] [--no-global]
#
# Options / env overrides:
#   -r, SDD_REF         git ref to build (tag / branch / commit). Default: v1.11.0
#   -u, SDD_REPO_URL    repo URL. Default: https://github.com/amah/smart-data-dico.git
#   -d, SDD_WORKDIR     working clone dir. Default: $HOME/.smart-data-dico/src
#       --pack-only     build + pack the tarball, do NOT install globally
#       --no-global     alias for --pack-only
#
# Examples:
#   scripts/install-from-git.sh                       # build v1.11.0 and install globally
#   scripts/install-from-git.sh -r v1.11.0 --pack-only
#   SDD_REPO_URL=git@github.com:amah/smart-data-dico.git scripts/install-from-git.sh

set -euo pipefail

REPO_URL="${SDD_REPO_URL:-https://github.com/amah/smart-data-dico.git}"
REF="${SDD_REF:-v1.11.0}"
WORKDIR="${SDD_WORKDIR:-$HOME/.smart-data-dico/src}"
GLOBAL=1

while [ $# -gt 0 ]; do
  case "$1" in
    -r) REF="$2"; shift 2 ;;
    -u) REPO_URL="$2"; shift 2 ;;
    -d) WORKDIR="$2"; shift 2 ;;
    --pack-only|--no-global) GLOBAL=0; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

# 1. Clone or update the repo, then pin to the requested ref.
if [ -d "$WORKDIR/.git" ]; then
  log "Updating existing clone in $WORKDIR"
  git -C "$WORKDIR" fetch --tags --prune origin
else
  log "Cloning $REPO_URL → $WORKDIR"
  mkdir -p "$(dirname "$WORKDIR")"
  git clone "$REPO_URL" "$WORKDIR"
fi
log "Checking out $REF"
git -C "$WORKDIR" checkout --force "$REF"
git -C "$WORKDIR" submodule update --init --recursive 2>/dev/null || true

cd "$WORKDIR"

# 2. Install dependencies. No npm workspaces here — root, frontend and backend
#    each have their own package.json + lockfile.
install_deps() {
  local dir="$1"
  log "Installing dependencies in ${dir:-.}"
  ( cd "${dir:-.}" && { npm ci || npm install; } )
}
install_deps .
install_deps frontend
install_deps backend

# 3. Build both bundles (frontend Vite build + backend esbuild bundle).
log "Building frontend + backend"
npm run build

# 4. Pack a self-contained tarball (bin/ + backend/dist + frontend/dist).
log "Packing tarball"
TARBALL="$(npm pack --silent)"
TARBALL_PATH="$WORKDIR/$TARBALL"
log "Tarball: $TARBALL_PATH"

# 5. Optionally install the CLI globally.
if [ "$GLOBAL" -eq 1 ]; then
  log "Installing globally: npm install -g $TARBALL"
  npm install -g "$TARBALL_PATH"
  echo
  log "Done. Try:  smart-data-dico --data-dir /path/to/your/project"
else
  echo
  log "Skipped global install. To install now or on another (offline) machine:"
  echo "    npm install -g \"$TARBALL_PATH\""
fi
