# Contributing to LiveSQL

Thanks for your interest in contributing! LiveSQL is an open-source project and we welcome contributions of all kinds.

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- Docker (for PostgreSQL with `wal_level=logical`)

### Setup

```bash
git clone https://github.com/mahabubul470/LiveSQL.git
cd LiveSQL
pnpm install

# Start test PostgreSQL
docker compose -f docker-compose.test.yml up -d

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Package Structure

```
packages/core       → Shared types and wire protocol (zero dependencies)
packages/server     → WAL CDC engine + WebSocket server (depends on core)
packages/client     → Framework-agnostic browser client (depends on core)
packages/react      → React hooks (depends on client)
packages/vue        → Vue composables (depends on client)
packages/svelte     → Svelte stores (depends on client)
```

Each package builds independently: `pnpm --filter @livesql/<package> build`

## Development Workflow

1. Fork the repo and create a branch from `main`:

   ```
   feat/my-feature
   fix/bug-description
   docs/update-something
   ```

2. Make your changes and add tests (vitest)

3. Run checks:

   ```bash
   pnpm test        # all tests
   pnpm lint        # eslint + prettier
   pnpm typecheck   # TypeScript strict mode
   ```

4. Open a pull request against `main`

## Coding Conventions

- **TypeScript strict mode** — `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`
- **Files**: `kebab-case.ts`
- **Classes**: `PascalCase`
- **Functions/variables**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Interfaces**: `PascalCase` (no `I` prefix)
- Use `interface` for object shapes, `type` for unions/intersections
- Use `BigInt` for offsets and LSNs
- Export types explicitly — no `export *`

## Commit Messages

Use [conventional commits](https://www.conventionalcommits.org/):

```
feat(core): add ChangeEvent wire protocol types
fix(server): prevent WAL slot leak on disconnect
test(integration): add reconnection backfill test
docs: update architecture diagram
```

## Running Specific Tests

```bash
# Unit tests for a package
pnpm --filter @livesql/server test

# Integration tests (requires Docker PostgreSQL)
pnpm --filter integration test

# Chaos tests
npx vitest run --config tests/chaos/vitest.config.ts tests/chaos/
```

## Architecture

Before diving into the code, read these docs:

- [Architecture overview](docs/architecture.md) — system design and data flow
- [API specification](docs/api-spec.md) — wire protocol and public APIs
- [Decision records](docs/decisions.md) — why things are built this way
- [Failure modes](docs/failure-modes.md) — production risks and mitigations

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
