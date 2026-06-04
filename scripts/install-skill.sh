#!/usr/bin/env bash
#
# Install the Smart Data Dictionary authoring skill for Claude Code by copying
# the docs/ folder (which contains SKILL.md + the format reference) into the
# skills directory under the name "smart-data-dico".
#
# Usage:
#   scripts/install-skill.sh            # install to ~/.claude/skills/smart-data-dico
#   scripts/install-skill.sh <dir>      # install into <dir>/smart-data-dico (e.g. a project's .claude/skills)
#
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
src="$repo_root/docs"

skills_dir="${1:-$HOME/.claude/skills}"
dest="$skills_dir/smart-data-dico"

if [ ! -f "$src/SKILL.md" ]; then
  echo "error: $src/SKILL.md not found — run this from the smart-data-dico repo." >&2
  exit 1
fi

mkdir -p "$skills_dir"
rm -rf "$dest"
cp -R "$src" "$dest"

echo "Installed skill 'smart-data-dico' -> $dest"
