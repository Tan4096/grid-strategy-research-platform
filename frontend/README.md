# Frontend Developer Guide

中文：本文件面向前端开发者。仓库公开介绍与上手方式请先看根目录 `README.md`。  
English: This file is for frontend contributors. Start with the root `README.md` for the public overview and quick start.

## Stack

- React 18
- TypeScript
- Vite
- Tailwind CSS
- ECharts
- Vitest + Playwright

## Local Run

```bash
make doctor
cd frontend
npm ci
npm run dev
```

先确认当前环境是 Node `20.x`，再执行一次干净的 `npm ci`。

## Common Commands

```bash
npm run capture:readme-screenshots
npm run lint
npm run typecheck
npm run gen:api-types
npm run test:unit
npm run build
npm run test:e2e
```

`npm run capture:readme-screenshots` rebuilds the masked README gallery images under `docs/assets/`.
`npm run gen:api-types` should leave `src/lib/api.generated.ts` unchanged when the checked-in contract is current.

## Project Shape

- `src/components/`: UI components
- `src/hooks/`: workspace controllers and state hooks
- `src/lib/`: API clients, transforms, shared helpers
- `src/types.ts`: shared frontend types
- `tests/e2e/`: Playwright flows

## Live Monitoring Credentials

Live monitoring credentials are sensitive.

Public-open-source expectation:

- credentials should not silently restore by default
- persistence must be explicit opt-in
- shared devices should not keep saved credentials

## Contribution Notes

- Keep UI behavior compatible unless the change is intentional and documented.
- Prefer small focused changes over broad visual rewrites.
- Update tests when changing view-model or API behavior.

## OpenAPI contract sync

```bash
make frontend-contract-sync
```

`make frontend-contract-sync` exports the current FastAPI OpenAPI schema into `frontend/openapi.json` and regenerates `src/lib/api.generated.ts`.
