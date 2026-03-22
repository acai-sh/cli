FROM oven/bun:slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Switch to the non-root 'bun' user
USER bun

# Install OpenCode AS the 'bun' user so it updates /home/node/.bashrc and installs locally
RUN curl -fsSL https://opencode.ai/install | bash
