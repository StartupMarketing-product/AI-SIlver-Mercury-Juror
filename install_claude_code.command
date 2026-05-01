#!/bin/bash
# Installs the Claude Code CLI globally via npm.
# Double-click this file in Finder to run.

set -e

echo "==> Checking Node.js version…"
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed. Install Node 18+ from https://nodejs.org first."
  echo "Press any key to close…"
  read -n 1
  exit 1
fi
NODE_VERSION=$(node -v)
echo "    Node version: $NODE_VERSION"

echo
echo "==> Checking if Claude Code is already installed…"
if command -v claude >/dev/null 2>&1; then
  CURRENT=$(claude --version 2>&1 | head -1)
  echo "    Already installed: $CURRENT"
  echo "==> Updating to latest…"
fi

echo
echo "==> Installing/updating @anthropic-ai/claude-code globally…"
echo "    (this may ask for your password if npm needs sudo)"
echo
npm install -g @anthropic-ai/claude-code

echo
echo "==> Verifying install…"
if command -v claude >/dev/null 2>&1; then
  claude --version
  echo
  echo "✅  Claude Code is installed."
  echo
  echo "Next: double-click 'start_claude_code.command' to launch it in this project."
else
  echo "❌ Install completed but 'claude' command not found in PATH."
  echo "   Try opening a new Terminal window."
fi

echo
echo "Press any key to close this window…"
read -n 1
