SHELL := /bin/bash
BACKEND_PYTHON ?= backend/.venv/bin/python
FRONTEND_DIR := frontend

.PHONY: dev test build e2e backend-test frontend-test frontend-build frontend-lint frontend-contract oss-check review-surface

dev:
	./start-dev.sh

backend-test:
	$(BACKEND_PYTHON) -m pytest backend/tests -q

frontend-lint:
	cd $(FRONTEND_DIR) && npm run lint

frontend-contract:
	cd $(FRONTEND_DIR) && npm run gen:api-types && git diff --exit-code -- src/lib/api.generated.ts

frontend-test:
	cd $(FRONTEND_DIR) && npm run test:unit

frontend-build:
	cd $(FRONTEND_DIR) && npm run build

test: backend-test frontend-test

build: frontend-build

e2e:
	cd $(FRONTEND_DIR) && npm run test:e2e

oss-check:
	bash release/check-open-source-readiness.sh

review-surface:
	bash release/review-public-surface.sh
