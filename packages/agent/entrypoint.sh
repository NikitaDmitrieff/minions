#!/bin/bash
set -e

# Initialize persistent volume on first deploy.
# When a Railway volume is mounted at $HOME, it starts empty.
# This script ensures essential files exist before the app starts.

# Claude Code onboarding flag — required for headless CLI operation
if [ ! -f "$HOME/.claude.json" ]; then
  echo '{"hasCompletedOnboarding":true}' > "$HOME/.claude.json"
  echo "[entrypoint] Created $HOME/.claude.json (onboarding flag)"
fi

# Claude credentials directory
if [ ! -d "$HOME/.claude" ]; then
  mkdir -p "$HOME/.claude"
  echo "[entrypoint] Created $HOME/.claude/"
fi

# Git config (may be missing on fresh volume)
if [ ! -f "$HOME/.gitconfig" ]; then
  git config --global user.email "agent@feedback-chat"
  git config --global user.name "feedback-agent"
  echo "[entrypoint] Created $HOME/.gitconfig"
fi

exec "$@"
