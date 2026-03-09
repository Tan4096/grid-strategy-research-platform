# First Release Commit Groups

Use this guide to keep the first public history readable.

## Recommended order

1. `01-oss-surface`
2. `02-backend-infra`
3. `03-backend-features`
4. `04-frontend-features`
5. `05-generated-assets`

## Stage a group

From the repository root:

```bash
bash release/stage-commit-group.sh --reset 01-oss-surface
bash release/stage-commit-group.sh 02-backend-infra
bash release/stage-commit-group.sh 03-backend-features
bash release/stage-commit-group.sh 04-frontend-features
bash release/stage-commit-group.sh 05-generated-assets
```

`--reset` clears the index first and is recommended before preparing the first public commit.

## Deferred from the first public commit

- `release/mobile-final-checklist.md`
- `release/RELEASE_NOTES_v1.0.0.md` until its wording is intentionally published
- release bundles such as `release/*.tar.gz` and `release/*.zip`

The deferred file list is also captured in `release/commit-groups/deferred.pathspec` for quick review.

## Validation checkpoints

Run these before pushing the public-facing commit:

```bash
make oss-check
make backend-test
make frontend-lint
make frontend-contract
make frontend-test
make frontend-build
```
