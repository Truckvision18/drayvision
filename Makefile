SHELL := /bin/bash
COMPOSE := docker compose -f infra/docker-compose.yml --env-file .env

.DEFAULT_GOAL := help
.PHONY: help setup install env up up-routing down logs ps test test-node test-mobile typecheck check smoke rights-doc migrate routing-deps tiles routing-it

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

setup: install env up smoke ## Install deps, create .env, start local infra, run smoke test

install: ## Install all dependencies (workspaces + mobile)
	@node -e 'const [maj,min]=process.versions.node.split(".").map(Number); if (maj<20||(maj===20&&min<11)) { console.error("Node >= 20.11 required (mobile toolchain: >= 22.11), found "+process.versions.node); process.exit(1) }'
	npm install
	npm --prefix apps/mobile install

env: ## Copy infra/.env.example to .env if missing
	@if [ ! -f .env ]; then cp infra/.env.example .env && echo "Created .env from infra/.env.example — fill in your keys."; else echo ".env exists — leaving it alone."; fi

up: env ## Start api + db + cache (docker compose)
	$(COMPOSE) up -d --build --wait

up-routing: env ## Start Valhalla too (requires built tiles; see services/routing/README.md)
	$(COMPOSE) --profile routing up -d --wait

down: ## Stop the local stack
	$(COMPOSE) --profile routing down

logs: ## Tail stack logs
	$(COMPOSE) logs -f --tail=100

ps: ## Show stack status
	$(COMPOSE) ps

test: test-node test-mobile ## Run all unit tests (no keys, no Docker needed)

test-node:
	npm run test:node

test-mobile:
	npm run test:mobile

typecheck: ## Strict TypeScript across api, shared, mobile
	npm run typecheck

check: typecheck test ## Typecheck + tests

smoke: ## Fail loudly on missing keys, then verify /health on the running stack
	npx tsx scripts/smoke.ts

routing-deps: ## Install the local routing toolchain (pyvalhalla + pyosmium; use a venv)
	pip install -r services/routing/requirements.txt

tiles: ## Build Valhalla tiles: make tiles EXTRACT=services/routing/extracts/<region>-<YYYY-MM-DD>.osm.pbf SHA=<sha256> [VALHALLA_BUILDER=local]
	@test -n "$(EXTRACT)" || { echo "usage: make tiles EXTRACT=<region-YYYY-MM-DD.osm.pbf> SHA=<sha256>"; exit 1; }
	services/routing/build-tiles.sh "$(EXTRACT)" $(SHA)

routing-it: ## Real-Valhalla integration tests on the synthetic network (needs routing-deps)
	services/routing/it.sh

rights-doc: ## Regenerate docs/RIGHTS.md from the rights registry
	npm run rights:doc

migrate: ## Apply DB migrations to $$DATABASE_URL
	npm -w @drayvision/api run migrate
