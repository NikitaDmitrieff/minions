# --- Build stage ---
FROM node:22-slim AS builder

WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.base.json tsconfig.json ./
COPY src/ src/
RUN npm run build

# --- Runtime stage ---
FROM node:22-slim

# System dependencies (git for cloning consumer repos, curl for health checks, tmux for SSH login sessions)
RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl ca-certificates tmux && \
    rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user — Claude Code CLI refuses --dangerously-skip-permissions as root
RUN useradd -m -s /bin/bash ccworker

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY --from=builder /app/dist/ dist/

# Entrypoint script (initializes persistent volume on first deploy)
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Ownership for non-root user (app dir + /tmp for job working directories)
RUN chown -R ccworker:ccworker /app /tmp
USER ccworker

# Git config for commits created by the agent
RUN git config --global user.email "agent@feedback-chat" && \
    git config --global user.name "feedback-agent"

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "dist/managed-worker.js"]
