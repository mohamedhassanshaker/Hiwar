# The targets of stack specification 8.7 and requirement 57.
SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help
PROFILE ?= full
CLUSTER ?= awp
# Rook needs a raw block device on the node, which a kind node on Windows or macOS has
# not got. Stack specification 7.3 names this escape; the development object store takes
# its place and speaks the same S3 API. Set NO_ROOK=0 on a Linux host with a loop device.
NO_ROOK ?= 1
export NO_ROOK
# The host the gateway is published on. 8080 and 8443 by default, because a web server
# holds 80 and 443 on the build machine; docs/12-user-and-developer-guides/local-platform.md explains the consequences.
HTTP_PORT ?= 8080
HTTPS_PORT ?= 8443
export HTTP_PORT
export HTTPS_PORT

.PHONY: help kind-up kind-down kind-reset deploy deploy-web deploy-agent dev-forward logs seed verify test-e2e test-live versions-lock dev-local dev-local-down railway-deploy railway-images railway-apps railway-copy-kind-data

help: ## Show the targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

kind-up: ## Create the kind cluster and bring the platform up (idempotent)
	PROFILE=$(PROFILE) CLUSTER_NAME=$(CLUSTER) NO_ROOK=$(NO_ROOK) infra/kind/bootstrap.sh

kind-down: ## Delete the cluster, keeping the registry cache
	kind delete cluster --name $(CLUSTER)

kind-reset: kind-down ## Recreate everything from scratch
	docker rm -f kind-registry kind-registry-ui >/dev/null 2>&1 || true
	"$(MAKE)" kind-up PROFILE=$(PROFILE)

deploy: ## Install or upgrade charts/awp on the running cluster
	helm upgrade --install awp infra/charts/awp \
		--namespace awp-app \
		--values infra/charts/values/values-local.yaml \
		--set config.appUrl=$$(scripts/public-origin.sh https awp.localtest.me) \
		--wait --timeout 15m

deploy-web: ## Rebuild the web image and roll out the web Deployment only
	REBUILD=1 ONLY=awp/web scripts/build-images.sh
	kubectl -n awp-app rollout restart deploy/web
	kubectl -n awp-app rollout status deploy/web --timeout=10m

deploy-agent: ## Rebuild the agent image and roll out the agent workloads only
	REBUILD=1 ONLY=awp/agent scripts/build-images.sh
	kubectl -n awp-app rollout restart deploy/agent-service
	kubectl -n awp-app get deploy -o name | grep agent-worker | xargs -r kubectl -n awp-app rollout restart
	kubectl -n awp-app rollout status deploy/agent-service --timeout=10m

dev-forward: ## Port-forward the platform services for host mode (stack specification 8.7)
	scripts/dev-forward.sh

logs: ## Tail a workload: make logs SERVICE=web
	kubectl -n awp-app logs -f deploy/$(SERVICE) --tail=200

seed: ## Load the organisation into the cluster database
	scripts/seed.sh

verify: ## Run every required check: lint, types, unit, database suites, build (what CI calls)
	scripts/verify.sh

test-e2e: ## Run the Playwright suite (tests/) against the kind deployment; MODE=fast|normal|full (default normal)
	scripts/test-e2e.sh

test-live: ## Run the live missions (they need the agent service) against the kind deployment
	PROJECT=live scripts/test-e2e.sh


versions-lock: ## Refresh the digests in versions.lock.md
	scripts/versions-lock.sh

dev-local: ## Start PostgreSQL, the mock identity provider and MinIO, then migrate and seed
	scripts/dev-local.sh

dev-local-down: ## Stop and remove the three local development containers
	docker rm -f awp-dev-db awp-dev-oidc awp-dev-minio >/dev/null 2>&1 || true

# Railway (D390): its own scripts under scripts/railway; nothing above is used or changed.
railway-deploy: ## Provision Railway, push the images to Docker Hub and deploy every service
	bash scripts/railway/deploy.sh

railway-images: ## Build and push the TAWP images to Docker Hub for Railway (ONLY=web for one)
	bash scripts/railway/images.sh

railway-apps: ## Point the Railway services at the current images and redeploy them
	bash scripts/railway/apps.sh

railway-copy-kind-data: ## Replace the Railway databases and buckets with a copy of the kind cluster's
	bash scripts/railway/copy-kind-data.sh
