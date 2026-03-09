# Open Source Release Checklist

## Repo hygiene
- [ ] `git status` is intentional and reviewed
- [ ] No `.env`, database files, build outputs, or logs are tracked
- [ ] No local-only TODOs remain in public docs
- [ ] Initial public commit stages only the OSS surface group

## Docs
- [ ] Root `README.md` is accurate from a clean checkout
- [ ] `backend/README.md` and `frontend/README.md` reflect current developer workflow
- [ ] Examples under `examples/` are valid
- [ ] At least one screenshot or GIF is prepared for the GitHub landing page

## Validation
- [ ] `make backend-test`
- [ ] `make frontend-contract`
- [ ] `make frontend-test`
- [ ] `make frontend-build`
- [ ] `make oss-check`

## Commit split
- [ ] Use `release/FIRST_RELEASE_COMMIT_GROUPS.md` to stage `01-oss-surface` first
- [ ] Keep `release/mobile-final-checklist.md` and any stale release memo out of the first public commit

## Security defaults
- [ ] Public deployment template enables auth / rate limit / audit by default
- [ ] Live credentials are not silently restored without explicit opt-in
- [ ] Security policy and disclosure path are visible
