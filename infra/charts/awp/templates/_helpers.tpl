{{/* The name every workload is labelled and selected by. */}}
{{- define "awp.fullname" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "awp.labels" -}}
app.kubernetes.io/part-of: awp
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end -}}

{{/*
A fully qualified image reference for one of the entries under `.Values.images`. Only the
images this repository builds carry the registry prefix; an upstream image is the
reference it already is, wherever it is pulled from.
*/}}
{{- define "awp.image" -}}
{{- $root := index . 0 -}}
{{- $name := index . 1 -}}
{{- $image := index $root.Values.images $name -}}
{{- if $image.local -}}
{{- printf "%s/%s:%s" $root.Values.image.registry $image.repository $image.tag -}}
{{- else -}}
{{- printf "%s:%s" $image.repository $image.tag -}}
{{- end -}}
{{- end -}}

{{/* The environment every application workload shares (stack specification 9). */}}
{{- define "awp.env" -}}
- name: APP_URL
  value: {{ .Values.config.appUrl | quote }}
- name: AUTH_URL
  value: {{ .Values.config.appUrl | quote }}
- name: TEMPORAL_ADDRESS
  value: {{ .Values.config.temporalAddress | quote }}
- name: TEMPORAL_NAMESPACE
  value: {{ .Values.config.temporalNamespace | quote }}
- name: AGW_LLM_URL
  value: {{ .Values.config.agwLlmUrl | quote }}
- name: AGW_MCP_BASE_URL
  value: {{ .Values.config.agwMcpBaseUrl | quote }}
- name: AI_NAMESPACE
  value: {{ .Values.aiNamespace | quote }}
- name: AI_GATEWAY_NAME
  value: {{ .Values.config.aiGatewayName | quote }}
- name: CONNECTOR_RUNTIME_URL
  value: {{ .Values.config.connectorRuntimeUrl | quote }}
# The one workload allowed out of the cluster. Testing a model connection calls the
# provider where it lives, and every other pod is closed to the internet.
- name: EGRESS_PROXY_URL
  value: "http://egress-proxy.{{ .Values.namespace }}.svc.cluster.local:{{ .Values.egressProxy.port }}"
- name: PHOENIX_BASE_URL
  value: {{ .Values.config.phoenixBaseUrl | quote }}
- name: PHOENIX_PUBLIC_ORIGIN
  value: {{ .Values.config.phoenixPublicOrigin | quote }}
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: {{ .Values.config.otlpEndpoint | quote }}
- name: NEO4J_URI
  value: {{ .Values.config.neo4jUri | quote }}
- name: VALKEY_URL
  value: {{ .Values.config.valkeyUrl | quote }}
- name: S3_ENDPOINT
  value: {{ .Values.config.s3Endpoint | quote }}
- name: S3_REGION
  value: {{ .Values.config.s3Region | quote }}
- name: S3_FORCE_PATH_STYLE
  value: "true"
- name: AGENT_SERVICE_URL
  value: {{ .Values.config.agentServiceUrl | quote }}
- name: PLATFORM_MCP_URL
  value: {{ .Values.config.platformMcpUrl | quote }}
- name: WEBAUTHN_RP_ID
  value: {{ .Values.config.webauthnRpId | quote }}
- name: LOG_LEVEL
  value: {{ .Values.config.logLevel | quote }}
- name: NODE_ENV
  value: production
{{- end -}}

{{/* The Secret `scripts/secrets-from-env.sh` creates for the namespace. */}}
{{- define "awp.envFrom" -}}
- secretRef:
    name: {{ .Values.secretName }}
{{- end -}}
