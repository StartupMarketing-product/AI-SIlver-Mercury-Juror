#!/bin/bash
# Launches Claude Code in this project folder.
# Double-click this file in Finder.

cd "$(dirname "$0")"

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code is not installed. Run 'install_claude_code.command' first."
  echo "Press any key to close…"
  read -n 1
  exit 1
fi

echo "Starting Claude Code in: $(pwd)"
echo
exec claude
