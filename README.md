# Acai.sh cli

The CLI is used to push specs and metadata about your codebase to the server, and to read implementation status and notes from an acai server.
It can work against our https://acai.sh server, or your own self-hosted instance.


## Local development
The repo includes a .devcontainer.json so you can get up and running quickly.
`devpod` cli is recommended.

### Connecting devcontainers

If you are developing the server in a separate devcontainer, and want to communicate with it, follow these instructions.

1. Find the network name (dynamically generated) e.g. `default-se-7d2ef_default`
2. Recreate the cli devcontainer, override the network:
```sh
export DEVCONTAINER_NETWORK=default-se-7d2ef_default
devpod up . --recreate
```
3. Confirm the server's reverse-proxy service is reachable `curl -I http://caddy:80`
4. When running the CLI, set `ACAI_API_BASE_URL` to `http://caddy:80/api/v1`

```sh
export ACAI_API_BASE_URL=http://caddy:80/api/v1

bun 
```
