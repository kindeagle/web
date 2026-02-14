# CLAUDE.md

## Project Overview

Base Web is a Yarn workspaces monorepo for the **Base** ecosystem — an Ethereum L2 blockchain built on the OP Stack by Coinbase. It contains three web applications and a shared component library.

## Repository Structure

```
web/
├── apps/
│   ├── web/          # Main base.org website (Next.js 15, App Router + Pages Router)
│   ├── bridge/       # Token bridge interface (Next.js 13)
│   └── base-docs/    # Developer docs at docs.base.org (Vocs)
├── libs/
│   └── base-ui/      # Shared React component library
├── tools/
│   └── ci/           # CI/CD scripts
├── .github/workflows/ # GitHub Actions CI
├── .husky/            # Git hooks (lint-staged)
└── .buildkite/        # Buildkite CI config
```

### Workspace Packages

| Package | Name | Framework |
|---------|------|-----------|
| `apps/web` | `@app/web` | Next.js 15.1.6 (hybrid App + Pages router) |
| `apps/bridge` | `@app/bridge` | Next.js 13.2.0 |
| `apps/base-docs` | `@app/base-docs` | Vocs 1.0.0-alpha.62 |
| `libs/base-ui` | `base-ui` | React component library |

## Development Setup

**Requirements:** Node.js >18.20.3, Yarn 3.5.0 (Corepack)

```bash
# Install dependencies
yarn install

# Run the main web app locally
yarn workspace @app/web dev

# Run the bridge app
yarn workspace @app/bridge dev

# Run the docs site
yarn workspace @app/base-docs dev
```

## Common Commands

```bash
# Build all workspaces
yarn build

# Lint all workspaces
yarn lint

# Run all tests
yarn test

# Build a specific workspace
yarn workspace @app/web build

# Lint a specific workspace
yarn workspace @app/web lint

# Run tests for the web app
yarn workspace @app/web test

# Analyze web app bundle size
yarn workspace @app/web analyze
```

## Architecture

### Web App (`apps/web`)

- **Routing:** Hybrid Next.js App Router (`app/`) + Pages Router (`pages/`). New pages should use the App Router.
  - `app/(base-org)/` — Route group for base.org marketing pages
  - `app/(basenames)/` — Route group for Basenames feature (ENS on Base)
  - `app/(stats)/` — Route group for analytics/stats pages
  - `pages/api/` — Legacy API routes
  - `app/api/` — App Router API routes
- **Components:** `src/components/` — 54+ React components organized by feature folder
- **Hooks:** `src/hooks/` — 24+ custom hooks (Web3 contracts, Basenames, attestations, pricing)
- **ABIs:** `src/abis/` — Ethereum smart contract ABIs
- **Addresses:** `src/addresses/` — Contract addresses by chain
- **Middleware:** `middleware.ts` handles redirects (docs, jobs, legacy routes)

### Styling

- **Tailwind CSS** is the primary styling approach across all apps
- Use `classnames` or `clsx` for conditional class composition
- Radix UI primitives for accessible component foundations
- Prettier plugin `prettier-plugin-tailwindcss` enforces class ordering

### State Management

- **React Context API** for global state (no Redux/Zustand)
- **React Query** (`@tanstack/react-query` v5) for server/async state
- **Wagmi** hooks for Web3 wallet and contract state
- Custom hooks for domain-specific logic

### Web3 Stack

- **Viem** 2.x — Low-level Ethereum library
- **Wagmi** 2.11.3 — React hooks for Ethereum
- **RainbowKit** — Wallet connection UI
- **OnchainKit** (`@coinbase/onchainkit`) — Coinbase Web3 SDK
- **Permissionless** — ERC-4337 account abstraction

### Data Layer

- **Vercel Postgres** (via Kysely ORM) for database
- **Vercel KV** for key-value storage
- **Vercel Blob** for file storage
- External APIs: Greenhouse (jobs), Neynar (Farcaster), Pinata (IPFS), Guild.xyz

## Code Conventions

### TypeScript

- **Strict mode** is enabled (`strict: true` in tsconfig)
- **No `any` types** — ESLint enforces `@typescript-eslint/no-explicit-any` with `fixToUnknown`
- Use `type` over `interface` (enforced: `consistent-type-definitions: ['error', 'type']`)
- Use array syntax `T[]` over `Array<T>` (enforced: `array-type: ['error', { default: 'array' }]`)
- Use `Record<K, V>` over index signatures (enforced: `consistent-indexed-object-style: ['error', 'record']`)
- Exhaustive switch statements required (`switch-exhaustiveness-check: 'error'`)
- No non-null assertions (`no-non-null-assertion: 'error'`)
- All promises must be handled (`no-floating-promises: 'error'`)
- Async functions must be marked `async` (`promise-function-async: 'error'`)
- Prefer nullish coalescing (`??`) over logical OR (`||`) for nullable values
- Prefer optional chaining (`?.`)

### React

- **Function declarations** for named components (not arrow functions):
  ```tsx
  // Correct
  export default function MyComponent() { ... }

  // Wrong
  const MyComponent = () => { ... }
  ```
- **Named event handlers** must follow `on*`/`handle*` convention (`jsx-handler-names: 'error'`)
- JSX only in `.jsx`, `.tsx`, or `.mdx` files
- No PropTypes — use TypeScript types exclusively
- Prop spreading is allowed
- Use `memo()` and `forwardRef()` with named functions for proper `displayName`

### Performance

ESLint warns on common React performance pitfalls:
- `react-perf/jsx-no-new-array-as-prop` (warn)
- `react-perf/jsx-no-new-function-as-prop` (warn)
- `react-perf/jsx-no-new-object-as-prop` (warn, except `style`)

### Formatting (Prettier)

- Print width: 100
- Tab width: 2 spaces (no tabs)
- Single quotes (double quotes in JSX)
- Trailing commas everywhere
- Semicolons required
- Arrow function parens always

### Imports

- No file extensions in imports (enforced: `import/extensions: ['error', 'never']`)
- Lint-staged runs ESLint and Prettier on `*.ts` and `*.tsx` files on commit

## Testing

- **Framework:** Jest 29 with `jsdom` environment
- **Libraries:** `@testing-library/react`, `@testing-library/jest-dom`
- **Config:** `apps/web/jest.config.js` (uses `next/jest`)
- **Run:** `yarn workspace @app/web test`
- Test files use `*.test.ts(x)` or `*.spec.ts(x)` naming

## CI/CD

GitHub Actions workflows on push to `master` and pull requests:
- **Unit Tests** (`.github/workflows/main.yml`) — runs `yarn install && yarn test`
- **Build** (`.github/workflows/node.js.yml`)
- **Bundle Size** (`.github/workflows/file-size-checker.yml`)
- **Search Index** (`.github/workflows/update-algolia.yml`)

Pre-commit hooks via Husky + lint-staged:
- `*.{ts,tsx}` — ESLint with `--cache --fix`
- `*.{ts,tsx,css,md}` — Prettier with `--write`

## Environment & Deployment

- Docker deployment via AWS ECR (see `apps/web/Dockerfile`)
- Vercel for hosting and serverless functions
- CSP headers configured in `apps/web/next.config.js`
- Datadog for monitoring (`dd-trace`, `@datadog/browser-rum`)
- Amplitude for feature flags and experiments

## Key Files

| File | Purpose |
|------|---------|
| `apps/web/next.config.js` | Next.js config with CSP, redirects, webpack rules |
| `apps/web/middleware.ts` | Request middleware (redirects, rewrites) |
| `apps/web/app/layout.tsx` | Root layout with providers |
| `apps/web/app/CryptoProviders.tsx` | Web3 provider setup (wagmi, RainbowKit) |
| `.eslintrc.js` | Root ESLint config (strict TypeScript + React rules) |
| `prettier.config.js` | Prettier formatting rules |
| `tsconfig.base.json` | Shared TypeScript config |
| `babel.config.js` | Babel config (Relay, path aliases) |
