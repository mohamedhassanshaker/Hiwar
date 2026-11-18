# Versions lock

Every container image and major package the platform pins, with the exact tag, the digest
that tag resolved to, and the licence. `scripts/versions-lock.sh` refreshes the digest
column from the registry; a digest that moves means the tag was re-pushed and the change
has to be reviewed.

Image digests resolved on **11 October 2026** with `docker buildx imagetools inspect`.
Package versions verified the same day against `apps/web/package-lock.json` and
`services/agent/uv.lock`, which are the resolutions an install actually gets.

Bitnami moved its freely pullable images to the `bitnamilegacy` organisation, so the Valkey
and development-object-store entries name that repository: the images the upstream charts
default to no longer resolve anonymously.

> **Three licence items need sign-off before Test or Live.** They are marked **SIGN-OFF**
> in the tables below and explained under [Licence sign-off](#licence-sign-off).

## Platform images

| Component | Image | Tag | Digest | Licence |
| --- | --- | --- | --- | --- |
| Local registry | `registry` | `3.0.0` | `sha256:6c5666b861f3505b116bb9aa9b25175e71210414bd010d92035ff64018f9457e` | Apache-2.0 |
| CNI | `quay.io/cilium/cilium` | `v1.17.8` | `sha256:6d7ea72ed311eeca4c75a1f17617a3d596fb6038d30d00799090679f82a01636` | Apache-2.0 |
| Gateway | `traefik` | `v3.7.14` | `sha256:575fa15b135078fe5e50aa847987d96dbddd7b093c172429618404df73f3fa7c` | MIT |
| Certificates | `quay.io/jetstack/cert-manager-controller` | `v1.19.1` | `sha256:cd49e769e18ada1fd7b9a9bacc87c90db24c65cbfd4bf71694dda7ed40e91187` | Apache-2.0 |
| PostgreSQL operator | `ghcr.io/cloudnative-pg/cloudnative-pg` | `1.27.0` | `sha256:9e5633b36f1f3ff0bb28b434ce51c95fbb8428a4ab47bc738ea403eb09dbf945` | Apache-2.0 |
| PostgreSQL | `ghcr.io/cloudnative-pg/postgresql` | `18.6` | `sha256:899d3ed526b659d77935dde0e6bf2d69dbbf17d3d8c6486ca8cfd04bd3c18533` | PostgreSQL licence |
| Graph store | `neo4j` | `5.26.0-community` | `sha256:5a015e53de1895e7eee1574ae0325cf8c4b89587222778108c594bdd45a474b5` | **SIGN-OFF** — GPLv3 (Community) |
| Cache and streams | `bitnamilegacy/valkey` | `8.1.3-debian-12-r2` | `sha256:2cdc3dc547a48e9a85f26061122ea5304864649cf5dbeb194eaf91c5d87168ab` | **SIGN-OFF** — BSD-3-Clause (Valkey); Redis is RSALv2/SSPLv1 |
| Object storage | `rook/ceph` | `v1.21.0` | `sha256:2c3a65786d3cc85ba15d7f258461c0bf392c6a6ee19dde8011259b8d34eeedd0` | Apache-2.0 (Rook) / LGPL (Ceph) |
| Workflow engine | `temporalio/server` | `1.29.0` | `sha256:a8020428066758a640d242c8447d7833321aa4e3c3d7635ae3877b7b8ae6ce61` | MIT |
| Workflow UI | `temporalio/ui` | `2.40.1` | `sha256:afc274fbc21e217ff4585394b604aa2f97fac71059bf301d9e70269bd164bd3a` | MIT |
| Workflow schema tools | `temporalio/admin-tools` | `1.29` | `sha256:4a17b5be706c56a9238fb7b5b32a36966cee14939658b20597837b2443b277c8` | MIT |
| AI gateway (control plane) | `cr.agentgateway.dev/controller` | `v1.6.0` | `sha256:d84259a7e2d87f8f39bae385d4b032d823c0a4450aecb32e0e31e2258449645b` | Apache-2.0 (Linux Foundation) |
| AI gateway (proxy) | `cr.agentgateway.dev/agentgateway` | `v1.6.0` | `sha256:9d3e6044ddcdc0878b1787f77bd401252b95e22684203fb5e874c4c42d2ed90c` | Apache-2.0 (Linux Foundation) |
| LLM traces and evaluation | `arizephoenix/phoenix` | `version-20.20.0-nonroot` | `sha256:2ac6874a4f743a626060adb6988b6dbd558530a0e06685334f63f8a779aaabb5` | **SIGN-OFF** — Elastic License 2.0 (SD-12) |
| Egress proxy | `ubuntu/squid` | `6.13-25.04_edge` | `sha256:3de2e64f0ca6efdac3e98557607dc0f23050037f3885016d5d5bfcf9950501b8` | GPL-2.0 (Squid) |
| Local OIDC (dev only) | `ghcr.io/navikt/mock-oauth2-server` | `2.1.10` | `sha256:65d4ed47ce094cc3849e41e03499bfb32372d69c726ec22b3d5a19eba9bc787e` | MIT |

## Development-only images

Used when `NO_ROOK=1`, which is the default on a laptop (stack specification 7.3). They are
not installed in Test or Live, where Rook Ceph RGW serves the S3 API.

| Component | Image | Tag | Digest | Licence |
| --- | --- | --- | --- | --- |
| Development object store | `bitnamilegacy/minio` | `2025.7.23-debian-12-r3` | `sha256:953d489a81cc4de7975f90e07202189c4325da39b0b92470b6a13c7ea99e36cd` | AGPL-3.0 |
| Development object store console | `bitnamilegacy/minio-object-browser` | `2.0.2-debian-12-r3` | `sha256:4ca163354c4f4e2cf87a0c6cf668f47d07f7f176b53d9bd4bd16b81df62b2763` | AGPL-3.0 |
| S3 client (bucket Job) | `bitnamilegacy/minio-client` | `2025.7.21-debian-12-r2` | `sha256:7a6b4b93998903f1673d2bd2140ac26b807c4224627b743778c5a8f70db561f1` | AGPL-3.0 |

## Application base images

| Image we build | Base | Tag | Digest | Licence |
| --- | --- | --- | --- | --- |
| `awp/web` | `node` | `24.11.0-bookworm-slim` | `sha256:76d0ed0ed93bed4f4376211e9d8fddac4d8b3fbdb54cc45955696001a3c91152` | MIT (Node.js) |
| `awp/agent`, `awp/sandbox-manager`, `awp/connector-runtime` | `python` | `3.12.12-slim-bookworm` | `sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c` | PSF |

## Helm charts

| Chart | Version | Source | Licence |
| --- | --- | --- | --- |
| cilium | 1.17.8 | `https://helm.cilium.io` | Apache-2.0 |
| traefik | 41.7.1 | `https://traefik.github.io/charts` | MIT |
| cert-manager | v1.19.1 | `https://charts.jetstack.io` | Apache-2.0 |
| cloudnative-pg | 0.26.0 | `https://cloudnative-pg.github.io/charts` | Apache-2.0 |
| agentgateway-crds | 1.6.0 | `oci://ghcr.io/agentgateway/charts/agentgateway-crds` | Apache-2.0 |
| agentgateway | 1.6.0 | `oci://ghcr.io/agentgateway/charts/agentgateway` | Apache-2.0 |
| rook-ceph | 1.21.0 | `https://charts.rook.io/release` | Apache-2.0 |
| rook-ceph-cluster | 1.21.0 | `https://charts.rook.io/release` | Apache-2.0 |
| valkey | 3.0.26 | `https://charts.bitnami.com/bitnami` | Apache-2.0 (chart) |
| minio (development only) | 17.0.21 | `oci://registry-1.docker.io/bitnamicharts/minio` | AGPL-3.0 |
| neo4j | 5.26.0 | `https://helm.neo4j.com/neo4j` | **SIGN-OFF** — GPLv3 |
| temporal | 0.68.0 | `https://go.temporal.io/helm-charts` | MIT |
| phoenix | in-repo (`infra/charts/phoenix`) | — | Elastic License 2.0 (the image) |
| Gateway API CRDs | v1.5.1 (experimental channel) | `kubernetes-sigs/gateway-api` | Apache-2.0 |

## Major packages

| Package | Version | Where | Licence |
| --- | --- | --- | --- |
| next | 16.4.0 | `apps/web` | MIT |
| react, react-dom | 19.3.0 | `apps/web` | MIT |
| typescript | 5.9.x | `apps/web` | Apache-2.0 |
| drizzle-orm | 0.45.x | `apps/web` | Apache-2.0 |
| drizzle-kit | 0.31.x | `apps/web` | MIT |
| pg | 8.17.x | `apps/web` | MIT |
| next-auth | 5.0.0-beta.32 | `apps/web` | ISC |
| @auth/drizzle-adapter | 1.11.x | `apps/web` | ISC |
| @simplewebauthn/server, @simplewebauthn/browser | 9.x | `apps/web` | MIT |
| zod | 4.x | `apps/web` | MIT |
| pino | 10.x | `apps/web` | MIT |
| vitest | 4.1.x | `apps/web` | MIT |
| @playwright/test | 1.64.x | `apps/web` | Apache-2.0 |
| @copilotkit/react-core | 1.78.0 | `apps/web` | MIT |
| @copilotkit/runtime | 1.78.0 | `apps/web` | MIT |
| @ag-ui/client | 1.0.2 | `apps/web` | MIT |
| @temporalio/client | 1.24.x | `apps/web` | MIT |
| @modelcontextprotocol/sdk | 1.32.x | `apps/web` | MIT |
| @aws-sdk/client-s3, @aws-sdk/s3-request-presigner | 3.1149.x | `apps/web` | Apache-2.0 |
| iovalkey | 0.4.x | `apps/web` | MIT |
| @kubernetes/client-node | 2.0.x | `apps/web` | Apache-2.0 |
| ajv, ajv-formats | 8.20.x, 3.0.x | `apps/web` | MIT |
| jose | 6.2.x | `apps/web` | MIT |
| uuidv7 | 1.0.x | `apps/web` | Apache-2.0 |
| python | 3.12 | `services/*` | PSF |
| fastapi | 0.121.x | `services/*` | MIT |
| uvicorn | 0.41.x | `services/*` | BSD-3-Clause |
| pydantic | 2.14.x | `services/*` | MIT |
| pydantic-ai-slim | 2.55.x | `services/agent` | MIT |
| graphiti-core | 0.30.x | `services/agent` | Apache-2.0 |
| psycopg, pgvector | 3.3.x, 0.5.x | `services/agent` | LGPL-3.0, PostgreSQL licence |
| valkey | 6.1.x | `services/agent` | MIT |
| arize-phoenix-otel | 0.17.x | `services/agent` | Elastic License 2.0 |
| opentelemetry-sdk | 1.45.x | `services/agent` | Apache-2.0 |
| openai | 3.28.x | `services/agent` | Apache-2.0 |
| neo4j | 5.28.x | `services/agent` | Apache-2.0 |
| boto3 | 1.43.x | `services/agent` | Apache-2.0 |
| docling | 2.137.x | `services/agent` (`parsers` extra) | MIT |
| temporalio | 1.34.x | `services/agent` | MIT |
| httpx | 0.28.x | `services/*` | BSD-3-Clause |
| structlog | 25.x | `services/*` | Apache-2.0 / MIT |
| kubernetes | 35.x | `services/sandbox`, `services/connectors` | Apache-2.0 |
| mcp | 1.30.x | `services/*` | MIT |
| ruff | 0.15.x | `services/*` | MIT |
| mypy | 1.20.x | `services/*` | MIT |
| pytest | 9.x | `services/*` | MIT |

## Licence sign-off

Three items need a decision before the platform is installed outside a developer machine.
None of them blocks local development.

### 1. Arize Phoenix (SD-12)

Phoenix is published under the **Elastic License 2.0**, which permits internal self-hosting
but forbids offering the software as a managed service to third parties and forbids removing
its licensing controls. The platform runs it internally and talks to it over OTLP and its
HTTP API. The decision to confirm is that internal self-hosting under that licence is
acceptable.

### 2. Valkey rather than Redis

Redis 7.4 and later are **RSALv2 / SSPLv1**, which are not open-source licences and which
restrict offering the software as a managed service. **Valkey** is the BSD-3-Clause fork and
is what the platform pins. The decision to confirm is that Valkey is acceptable to the
organisation, or that a Redis Enterprise subscription is bought instead.

### 3. Neo4j Community (GPLv3)

`neo4j:5.26.0-community` is **GPLv3**. The platform talks to it over Bolt and does not link
against it, so the copyleft does not reach Tahseel's own code. The decision to confirm is
that running a GPLv3 service inside the platform is acceptable, or that a Neo4j Enterprise
licence is bought — which is also what is needed for clustering and online backup in Live.

### A note on the development object store

The `bitnamilegacy/minio*` images above are **AGPL-3.0** and are used only on a developer
machine, where `NO_ROOK=1` leaves Rook out. Test and Live run Rook Ceph RGW (Apache-2.0 and
LGPL), so no AGPL-3.0 component is installed there and no sign-off is needed for it.
