# Contributing / 参与贡献

感谢你对 `Grid Strategy Research Platform` 的关注。

## Before you open a PR / 提交 PR 前

- Read the root `README.md` first.
- Make sure your change is scoped and easy to review.
- Prefer fixing one problem per pull request.
- Do not include secrets, `.env` values, local database files, or build artifacts.

## Local setup / 本地开发

```bash
make dev
```

Common commands:

```bash
make backend-test
make frontend-lint
make frontend-contract
make frontend-test
make frontend-build
make test
make oss-check
```

If you prefer running commands manually, see:

- `backend/README.md`
- `frontend/README.md`
- `deploy/README.md`

## Pull request checklist / PR 检查清单

- [ ] The change is explained clearly.
- [ ] Docs were updated when behavior changed.
- [ ] Backend tests pass.
- [ ] Frontend lint, unit tests, and build pass.
- [ ] No breaking API changes were introduced unless explicitly documented.
- [ ] No credentials, personal paths, or generated build outputs were committed.

## Scope expectations / 贡献范围建议

Good first contributions:

- Docs and examples
- Test coverage improvements
- UI polish with no API breakage
- Safer defaults for deployment or observability
- Small refactors that reduce hotspot complexity

Please open an issue first for:

- Large architectural changes
- New deployment targets
- Database/schema migrations
- Public API changes

## Coding style / 代码风格

- Keep changes focused and minimal.
- Prefer existing patterns over introducing new abstractions.
- Preserve current API contracts unless a change is intentional and documented.
- Add tests for behavior changes when there is a natural place to do so.
