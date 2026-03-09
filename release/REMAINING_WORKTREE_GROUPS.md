# Remaining Worktree Commit Groups

Use this guide for the post-rename worktree that is still uncommitted.

## Recommended order

1. `06-devx-config-docs`
2. `07-backend-settings-routing`
3. `08-frontend-contract-runtime-ux`

## Stage a group

From the repository root:

```bash
bash release/stage-commit-group.sh --reset 06-devx-config-docs
bash release/stage-commit-group.sh 07-backend-settings-routing
bash release/stage-commit-group.sh 08-frontend-contract-runtime-ux
```

`release/commit-groups/deferred.pathspec` still captures files that should stay out of these commits.

## Group intent

- `06-devx-config-docs`: CI, local doctor checks, config catalog generation, and related docs.
- `07-backend-settings-routing`: centralized settings usage, runtime guardrails, router split, and live snapshot backend plumbing.
- `08-frontend-contract-runtime-ux`: OpenAPI sync, frontend schema/type migration, polling/runtime helpers, and UI behavior updates that depend on the new contract.

## Suggested commit messages

- `06-devx-config-docs`: `chore: add repo guardrails and generated config docs`
- `07-backend-settings-routing`: `refactor: centralize backend settings and split API routers`
- `08-frontend-contract-runtime-ux`: `feat: sync frontend API contract and improve runtime UX`

## Deferred

Keep these out until you explicitly want them public:

- `release/RELEASE_NOTES_v1.0.0.md`
- `release/mobile-final-checklist.md`
