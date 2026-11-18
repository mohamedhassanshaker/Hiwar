"""Runtime configuration, read from the environment of stack specification section 9."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Every value the agent service needs. No domain-database URL is among them: the
    service reaches domain data only through the platform MCP server. It owns one
    database, `awp_kb`, which holds the passage vectors and is rebuildable."""

    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    service_name: str = Field(default="agent-service", alias="AWP_SERVICE_NAME")
    environment: str = Field(default="local", alias="AWP_ENV")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    temporal_address: str = Field(
        default="temporal-frontend.awp-ai.svc:7233", alias="TEMPORAL_ADDRESS"
    )
    temporal_namespace: str = Field(default="awp", alias="TEMPORAL_NAMESPACE")
    temporal_task_queue: str = Field(default="agent-runs", alias="TEMPORAL_TASK_QUEUE")

    # agentgateway is the single path for every model, MCP and A2A call (6.1). The LLM
    # listener speaks the OpenAI-compatible API; the MCP listener publishes the connectors.
    agw_llm_url: str = Field(
        default="http://ai-gateway.awp-ai.svc:8080", alias="AGW_LLM_URL"
    )
    agw_mcp_base_url: str = Field(
        default="http://ai-gateway.awp-ai.svc:8081", alias="AGW_MCP_BASE_URL"
    )
    # The per-run JWT the web application mints. agentgateway validates it and decides
    # which connectors and models this run may reach, so it is the only credential here.
    run_token: str = Field(default="", alias="AWP_RUN_TOKEN")

    platform_mcp_url: str = Field(
        default="http://web.awp-app.svc:3000/api/mcp", alias="PLATFORM_MCP_URL"
    )
    platform_mcp_token: str = Field(default="", alias="PLATFORM_MCP_TOKEN")
    # What `ScheduleFireWorkflow` proves it is to the firing route (flow F-06): a
    # Temporal Schedule has no session and no run token, so this bearer secret — the same
    # one the web application reads from the same Secret — is the only thing it carries.
    maintenance_api_token: str = Field(default="", alias="MAINTENANCE_API_TOKEN")

    sandbox_manager_url: str = Field(
        default="http://sandbox-manager.awp-app.svc:8080", alias="SANDBOX_MANAGER_URL"
    )

    valkey_url: str = Field(
        default="valkey://valkey-primary.awp-data.svc:6379/0", alias="VALKEY_URL"
    )
    # The passage vectors of 6.5, in the `awp_kb` database on the AWP PostgreSQL cluster.
    kb_database_url: str = Field(default="", alias="KB_DATABASE_URL")

    neo4j_url: str = Field(default="bolt://neo4j.awp-data.svc:7687", alias="NEO4J_URI")
    # Neo4j publishes its credential as one `user/password` value and the deployment carries
    # it in that form, so that is the one this reads. The two separate names stay for a
    # developer running the service against a database of their own.
    neo4j_auth: str = Field(default="", alias="NEO4J_AUTH")
    neo4j_user_override: str = Field(default="", alias="NEO4J_USER")
    neo4j_password_override: str = Field(default="", alias="NEO4J_PASSWORD")

    # The development object store that `NO_ROOK=1` installs, which is the default on a
    # laptop (stack specification 7.3). Test and Live run Rook Ceph RGW and set S3_ENDPOINT
    # from the ObjectBucketClaim, so this default is never the one in use there. Only the
    # S3 API is called either way.
    s3_endpoint: str = Field(default="http://minio.awp-data.svc:9000", alias="S3_ENDPOINT")
    s3_region: str = Field(default="us-east-1", alias="S3_REGION")
    s3_access_key: str = Field(default="", alias="S3_ACCESS_KEY")
    s3_secret_key: str = Field(default="", alias="S3_SECRET_KEY")
    s3_bucket_documents: str = Field(default="raw-docs", alias="S3_BUCKET_DOCUMENTS")
    s3_bucket_artifacts: str = Field(default="artifacts", alias="S3_BUCKET_ARTIFACTS")
    s3_bucket_run_payloads: str = Field(default="run-payloads", alias="S3_BUCKET_RUN_PAYLOADS")

    # Arize Phoenix (6.3). Traces arrive over OTLP with the run id as the trace id; the
    # API key is for datasets, experiments and prompts.
    otlp_endpoint: str = Field(
        default="http://phoenix.awp-ai.svc:6006/v1/traces", alias="OTEL_EXPORTER_OTLP_ENDPOINT"
    )
    phoenix_base_url: str = Field(
        default="http://phoenix.awp-ai.svc:6006", alias="PHOENIX_BASE_URL"
    )
    phoenix_api_key: str = Field(default="", alias="PHOENIX_API_KEY")

    skills_path: str = Field(default="/app/skills", alias="AWP_SKILLS_PATH")
    embedding_route: str = Field(default="embedding-default", alias="AWP_EMBEDDING_ROUTE")

    @property
    def neo4j_user(self) -> str:
        """The Neo4j user: the override when one is set, otherwise `NEO4J_AUTH`'s."""
        if self.neo4j_user_override:
            return self.neo4j_user_override
        user, _, _ = self.neo4j_auth.partition("/")
        return user or "neo4j"

    @property
    def neo4j_password(self) -> str:
        """The Neo4j password, read the same way.

        Empty means the driver sends no credentials, which a database with authentication
        on refuses with "Unsupported authentication token" — and every graph read and the
        graph half of an ingestion run fail with it.
        """
        if self.neo4j_password_override:
            return self.neo4j_password_override
        _, _, password = self.neo4j_auth.partition("/")
        return password

    @property
    def tracing_enabled(self) -> bool:
        """Tracing is on when an OTLP endpoint is configured. The `core` profile leaves
        Phoenix out, and the run timeline in the console is the only trace then."""
        return bool(self.otlp_endpoint)

    @property
    def vectors_enabled(self) -> bool:
        """Vector retrieval needs the `awp_kb` database."""
        return bool(self.kb_database_url)


@lru_cache(maxsize=1)
def settings() -> Settings:
    """The process-wide settings, read once."""
    return Settings()
