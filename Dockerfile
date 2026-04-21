FROM oven/bun:slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Switch to the non-root 'bun' user
USER bun

# postinstall adds deps + opencode cli, see .devcontainer.json
