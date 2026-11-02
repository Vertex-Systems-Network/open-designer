# @open-designer/cloud

Optional, self-hostable OpenDesigner Cloud: accounts, workspaces, immutable document revisions in
S3-compatible storage, sharing, enrollment, quotas, and transactional email. The editor stays
local-first and works without it.

## Subpaths

- `@open-designer/cloud/contract` — Valibot network contracts and public types.
- `@open-designer/cloud/client` — discovery, authentication, device authorization, and the typed client.
- `@open-designer/cloud/email` — Vue Email rendering.
- `@open-designer/cloud/server` — runtime-neutral Hono routes and services with injected dependencies.
- `@open-designer/cloud/runtime/node` — PostgreSQL, S3, SMTP, the HTTP listener, and workers.
- Cloudflare Workers can use PostgreSQL through Hyperdrive or Turso/libSQL through `TURSO_URL` and
  `TURSO_AUTH_TOKEN`.

## Running

The Node runtime reads one deployment TOML file named by `OPENDESIGNER_CLOUD_CONFIG` and resolves
secrets from the environment. Start from
[`deploy/opendesigner-cloud.example.toml`](./deploy/opendesigner-cloud.example.toml), then build and run
the server on Node 22 or later, installed from npm or built from a checkout:

```sh
npx -p @open-designer/cloud opendesigner-cloud   # opendesigner-ai-relay runs the AI relay
bun --filter @open-designer/cloud build:standalone && bun --filter @open-designer/cloud start
```

The server migrates the database before it accepts requests. The
[self-hosting guide](https://openpencil.dev/reference/self-hosting-cloud) covers building with the
portal, configuration, the editor address, operator commands, and upgrades;
[`deploy/README.md`](./deploy/README.md) covers local development and end-to-end tests, and
[`deploy/security.md`](./deploy/security.md) covers hardening. The design is described in
[Cloud Architecture](https://openpencil.dev/development/cloud).

## Tests

`bun run test:cloud` from the repository root type-checks the package and runs unit and PGlite
integration tests. `bun --filter @open-designer/cloud test:e2e` runs the Docker Compose end-to-end
suite against PostgreSQL and SeaweedFS.
