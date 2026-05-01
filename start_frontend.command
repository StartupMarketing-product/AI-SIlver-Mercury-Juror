#!/bin/bash
# Double-click this file in Finder to start the frontend dev server.
# It will install dependencies if missing, then start Vite, then open the browser.

set -e

cd "$(dirname "$0")/frontend"

echo "==> Frontend folder: $(pwd)"
echo

if [ ! -d node_modules ]; then
  echo "==> Installing npm dependencies (first run only — takes ~1 min)…"
  npm install
  echo
fi

echo "==> Starting Vite dev server…"
echo "==> Once you see 'ready in …', a browser tab will open at http://localhost:5173"
echo

# Open the browser ~3 seconds after Vite starts
( sleep 3 && open "http://localhost:5173" ) &

npm run dev
