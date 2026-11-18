# agentgateway for Railway (D390): the upstream image with the static configuration beside it.
# The upstream image is distroless, so nothing runs at build time; provider keys arrive as
# Railway variables (`$OPENROUTER_API_KEY`, `$MODEL_ENGINE_URL`) the config expands.
FROM cr.agentgateway.dev/agentgateway:v1.7.0
COPY config.yaml /config.yaml
EXPOSE 8080
CMD ["-f", "/config.yaml"]
