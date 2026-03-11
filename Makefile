SHELL := /bin/bash
BACKEND_PYTHON ?= backend/.venv/bin/python
FRONTEND_DIR := frontend

.PHONY: dev doctor env-example config-docs docs-drift test build e2e backend-test backend-lint backend-typecheck frontend-test frontend-typecheck frontend-build frontend-lint frontend-contract frontend-openapi frontend-contract-sync oss-check review-surface

dev:
	./start-dev.sh

doctor:
	bash scripts/doctor.sh

env-example:
	python3 scripts/render_env_example.py

config-docs: env-example
	python3 scripts/render_config_reference.py
	python3 scripts/render_readme_config_snippets.py

backend-lint:
	$(BACKEND_PYTHON) -m ruff check backend/app/api backend/app/core backend/app/tasks/arq_queue.py backend/app/services/live_snapshot*.py

backend-typecheck:
	$(BACKEND_PYTHON) -m mypy --config-file pyproject.toml

frontend-typecheck:
	cd $(FRONTEND_DIR) && npm run typecheck

frontend-openapi:
	$(BACKEND_PYTHON) backend/scripts/export_openapi.py frontend/openapi.json

frontend-contract-sync: frontend-openapi
	cd $(FRONTEND_DIR) && npm run gen:api-types

backend-test:
	$(BACKEND_PYTHON) -m pytest backend/tests -q

frontend-lint:
	cd $(FRONTEND_DIR) && npm run lint

frontend-contract:
	cd $(FRONTEND_DIR) && npm run gen:api-types && git diff --exit-code -- openapi.json src/lib/api.generated.ts

docs-drift:
	make config-docs
	git diff --exit-code -- deploy/.env.example deploy/CONFIG_REFERENCE.md README.md deploy/README.md backend/README.md

frontend-test:
	cd $(FRONTEND_DIR) && npm run test:unit

frontend-build:
	cd $(FRONTEND_DIR) && npm run build

test: backend-test frontend-typecheck frontend-test

build: frontend-build

e2e:
	cd $(FRONTEND_DIR) && npm run test:e2e

oss-check:
	bash release/check-open-source-readiness.sh

review-surface:
	bash release/review-public-surface.sh
