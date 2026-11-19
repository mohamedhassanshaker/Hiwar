# Local platform targets (tech-stack.md): the kind cluster, the Helm chart, seeding and checks.
SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help
PROFILE ?= full
# The local secrets file scripts/secrets-from-env.sh reads; copy .env.example.platform to it.
ENV_FILE ?= .env.platform
export ENV_FILE
CLUSTER ?= hiwar
# Rook needs a raw block device on the node, which a kind node on Windows or macOS has
# not got. Stack specification 7.3 names this escape; the development object store takes
# its place and speaks the same S3 API. Set NO_ROOK=0 on a Linux host with a loop device.
NO_ROOK ?= 1
export NO_ROOK
# The host the gateway is published on. 8080 and 8443 by default, because a web server
# holds 80 and 443 on the build machine; docs/08-devops-and-deployment/deployment.md explains the consequences.
HTTP_PORT ?= 8080
HTTPS_PORT ?= 8443
export HTTP_PORT
export HTTPS_PORT

.PHONY: help kind-up kind-down kind-reset deploy deploy-web deploy-agent dev-forward logs seed verify test-e2e versions-lock dev-local dev-local-down

help: ## Show the targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

kind-up: ## Create the kind cluster and bring the platform up (idempotent)
	PROFILE=$(PROFILE) CLUSTER_NAME=$(CLUSTER) NO_ROOK=$(NO_ROOK) infra/kind/bootstrap.sh

kind-down: ## Delete the cluster, keeping the registry cache
	kind delete cluster --name $(CLUSTER)

kind-reset: kind-down ## Recreate everything from scratch
	docker rm -f kind-registry kind-registry-ui >/dev/null 2>&1 || true
	"$(MAKE)" kind-up PROFILE=$(PROFILE)

deploy: ## Install or upgrade charts/hiwar on the running cluster
	helm upgrade --install hiwar infra/charts/hiwar \
		--namespace hiwar-app \
		--values infra/charts/values/values-local.yaml \
		--set config.appUrl=$$(scripts/public-origin.sh https hiwar.localtest.me) \
		--wait --timeout 15m

deploy-web: ## Rebuild the web image and roll out the web Deployment only
	REBUILD=1 ONLY=hiwar/web scripts/build-images.sh
	kubectl -n hiwar-app rollout restart deploy/web
	kubectl -n hiwar-app rollout status deploy/web --timeout=10m

deploy-agent: ## Rebuild the agent image and roll out the agent workloads only
	REBUILD=1 ONLY=hiwar/agent scripts/build-images.sh
	kubectl -n hiwar-app rollout restart deploy/agent-service
	kubectl -n hiwar-app get deploy -o name | grep agent-worker | xargs -r kubectl -n hiwar-app rollout restart
	kubectl -n hiwar-app rollout status deploy/agent-service --timeout=10m

dev-forward: ## Port-forward the platform services for host mode (stack specification 8.7)
	scripts/dev-forward.sh

logs: ## Tail a workload: make logs SERVICE=web
	kubectl -n hiwar-app logs -f deploy/$(SERVICE) --tail=200

seed: ## Load the organisation into the cluster database
	scripts/seed.sh

verify: ## Run every required check: lint, types, unit, database suites, build (what CI calls)
	scripts/verify.sh

test-e2e: ## Run the Playwright journey (tests/e2e) against the kind deployment
	scripts/test-e2e.sh


versions-lock: ## Refresh the digests in versions.lock.md
	scripts/versions-lock.sh

dev-local: ## Start PostgreSQL, the mock identity provider and MinIO, then migrate and seed
	scripts/dev-local.sh

dev-local-down: ## Stop and remove the three local development containers
	docker rm -f hiwar-dev-db hiwar-dev-oidc hiwar-dev-minio >/dev/null 2>&1 || true
