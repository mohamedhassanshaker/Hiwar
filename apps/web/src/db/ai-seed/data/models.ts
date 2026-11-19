/** The prototype's model providers, their connections and the routes. */
type ProviderConnectionSeed = { id: string; n: string; ep: string; auth: string; region: string; on: boolean; allow: string[]; st: string };
type ProviderSeed = {
  id: string;
  n: string;
  ini: string;
  c: string;
  kind: string;
  engine?: string;
  on: boolean;
  models: string[];
  conns: ProviderConnectionSeed[];
};
type ModelRouteSeed = {
  a: string;
  use: [string, string];
  schema?: string;
  voice?: string;
  embedding?: boolean;
  decision?: boolean;
  chain: [string, string, string][];
  agents: number;
};

export const PROV_SEED: ProviderSeed[] = [
  { id: 'anthropic', n: 'Anthropic', ini: 'A', c: 'var(--chart-series-5)', kind: 'Cloud', on: true, models: ['claude-opus-4.1', 'claude-sonnet-4.5', 'claude-haiku-4.5'], conns: [{ id: 'anth-prod', n: 'Production', ep: 'api.anthropic.com', auth: 'API key', region: 'Global', on: true, allow: ['claude-sonnet-4.5', 'claude-haiku-4.5'], st: 'Healthy' }, { id: 'anth-rnd', n: 'R&D sandbox', ep: 'api.anthropic.com', auth: 'API key', region: 'Global', on: false, allow: ['claude-opus-4.1'], st: 'Disabled' }] },
  { id: 'openai', n: 'OpenAI', ini: 'O', c: 'var(--chart-series-6)', kind: 'Cloud', on: true, models: ['gpt-4.1', 'gpt-4.1-mini', 'o4-mini', 'text-embedding-3-large', 'gpt-realtime', 'gpt-4o-transcribe', 'gpt-4o-mini-tts'], conns: [{ id: 'oai-main', n: 'Main', ep: 'api.openai.com', auth: 'API key', region: 'Global', on: true, allow: ['text-embedding-3-large', 'gpt-realtime', 'gpt-4o-transcribe', 'gpt-4o-mini-tts'], st: 'Healthy' }] },
  { id: 'azure', n: 'Azure OpenAI', ini: 'Az', c: 'var(--chart-series-1)', kind: 'Cloud', on: true, models: ['gpt-4.1', 'gpt-4.1-mini', 'o4-mini', 'gpt-realtime'], conns: [{ id: 'az-uaen', n: 'UAE North', ep: 'hiwar-uaen.openai.azure.com', auth: 'Entra ID', region: 'UAE North', on: true, allow: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-realtime'], st: 'Healthy' }, { id: 'az-weu', n: 'West Europe (DR)', ep: 'hiwar-weu.openai.azure.com', auth: 'Entra ID', region: 'West Europe', on: true, allow: ['gpt-4.1-mini'], st: 'Healthy' }] },
  { id: 'gemini', n: 'Google Gemini', ini: 'G', c: 'var(--chart-series-4)', kind: 'Cloud', on: false, models: ['gemini-2.5-pro', 'gemini-2.5-flash'], conns: [] },
  { id: 'bedrock', n: 'AWS Bedrock', ini: 'B', c: 'var(--chart-series-3)', kind: 'Cloud', on: true, models: ['claude-sonnet-4.5', 'llama-3.3-70b', 'titan-embed-v2'], conns: [{ id: 'br-me', n: 'me-central-1', ep: 'bedrock-runtime.me-central-1', auth: 'IAM role', region: 'UAE', on: true, allow: ['claude-sonnet-4.5'], st: 'Healthy' }] },
  { id: 'mistral', n: 'Mistral AI', ini: 'M', c: 'var(--chart-series-2)', kind: 'Cloud', on: false, models: ['mistral-large', 'mistral-small'], conns: [] },
  { id: 'cohere', n: 'Cohere', ini: 'C', c: 'var(--chart-series-5)', kind: 'Cloud', on: false, models: ['command-r-plus', 'rerank-v3.5'], conns: [] },
  { id: 'groq', n: 'Groq', ini: 'Gq', c: 'var(--chart-series-3)', kind: 'Cloud', on: false, models: ['llama-3.3-70b', 'mixtral-8x7b'], conns: [] },
  { id: 'deepseek', n: 'DeepSeek', ini: 'DS', c: 'var(--chart-series-1)', kind: 'Cloud', on: false, models: ['deepseek-chat', 'deepseek-reasoner'], conns: [] },
  { id: 'openrouter', n: 'OpenRouter', ini: 'OR', c: 'var(--chart-series-2)', kind: 'Custom', engine: 'OpenAI-compatible (other)', on: true, models: ['nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3.5-super-vl:free', 'cloudflare/clef-flash'], conns: [{ id: 'openrouter-main', n: 'Main', ep: 'https://openrouter.ai/api/v1', auth: 'Bearer token', region: 'Global', on: true, allow: ['nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3.5-super-vl:free', 'cloudflare/clef-flash'], st: 'Healthy' }] },
  // The deterministic local engine, registered the way any on-prem engine is (7.4.8). It is
  // the last fallback on every route below, so a machine with no provider key still runs
  // real work through a real route, and an install with keys never reaches it.
  { id: 'hiwar-local', n: 'Local engine', ini: 'L', c: 'var(--chart-series-5)', kind: 'Custom', engine: 'OpenAI-compatible (other)', on: true, models: ['hiwar-local-reasoning', 'hiwar-local-fast', 'hiwar-local-classifier', 'hiwar-local-embedding'], conns: [{ id: 'hiwar-local-cluster', n: 'In cluster', ep: 'http://model-engine.hiwar-app.svc.cluster.local:8080/v1', auth: 'None', region: 'Local', on: true, allow: ['hiwar-local-reasoning', 'hiwar-local-fast', 'hiwar-local-classifier', 'hiwar-local-embedding'], st: 'Healthy' }] },
  { id: 'vllm', n: 'vLLM (on-prem)', ini: 'vL', c: 'var(--chart-series-6)', kind: 'Custom', engine: 'vLLM', on: true, models: ['qwen3-32b', 'llama-3.3-70b'], conns: [{ id: 'vllm-dc1', n: 'Dubai DC1 GPU', ep: 'http://10.20.4.11:8000/v1', auth: 'Bearer token', region: 'UAE (on-prem)', on: true, allow: ['qwen3-32b'], st: 'Degraded' }] },
];

/** The allowed models that answer at a provider's decisions endpoint rather than in chat (D290). */
export const DECISION_MODELS: readonly string[] = ['cloudflare/clef-flash'];

export const ROUTES0: ModelRouteSeed[] = [
  { a: 'reasoning-default', use: ['Main', 'رئيسي'], chain: [['anthropic', 'anth-prod', 'claude-sonnet-4.5'], ['azure', 'az-uaen', 'gpt-4.1'], ['openrouter', 'openrouter-main', 'nvidia/nemotron-3-ultra-550b-a55b:free'], ['hiwar-local', 'hiwar-local-cluster', 'hiwar-local-reasoning']], agents: 3 },
  { a: 'small-fast', use: ['Main (interactive)', 'رئيسي (تفاعلي)'], chain: [['anthropic', 'anth-prod', 'claude-haiku-4.5'], ['azure', 'az-weu', 'gpt-4.1-mini'], ['openrouter', 'openrouter-main', 'nvidia/nemotron-3.5-super-vl:free'], ['hiwar-local', 'hiwar-local-cluster', 'hiwar-local-fast']], agents: 2 },
  { a: 'vision', use: ['Auxiliary', 'مساعد'], chain: [['azure', 'az-uaen', 'gpt-4.1'], ['openrouter', 'openrouter-main', 'nvidia/nemotron-3.5-super-vl:free'], ['bedrock', 'br-me', 'claude-sonnet-4.5'], ['hiwar-local', 'hiwar-local-cluster', 'hiwar-local-reasoning']], agents: 1 },
  { a: 'embedding-default', use: ['Embedding', 'تضمين'], embedding: true, chain: [['openai', 'oai-main', 'text-embedding-3-large'], ['hiwar-local', 'hiwar-local-cluster', 'hiwar-local-embedding']], agents: 0 },
  { a: 'classifier-typed', use: ['Classification (typed output)', 'التصنيف (مخرجات مضبوطة النوع)'], schema: 'RequestClassification v3', chain: [['anthropic', 'anth-prod', 'claude-haiku-4.5'], ['azure', 'az-uaen', 'gpt-4.1-mini'], ['openrouter', 'openrouter-main', 'nvidia/nemotron-3.5-super-vl:free'], ['hiwar-local', 'hiwar-local-cluster', 'hiwar-local-classifier']], agents: 2 },
  { a: 'agent-choice', use: ['Agent choice', 'اختيار الوكيل'], decision: true, chain: [['openrouter', 'openrouter-main', 'cloudflare/clef-flash']], agents: 0 },
  { a: 'voice-realtime', use: ['Voice (speech-to-speech)', 'الصوت (كلام إلى كلام)'], voice: 'STT gpt-4o-transcribe · TTS gpt-4o-mini-tts · AR/EN', chain: [['azure', 'az-uaen', 'gpt-realtime'], ['openai', 'oai-main', 'gpt-realtime']], agents: 1 },
  { a: 'local-private', use: ['Restricted data', 'بيانات مقيدة'], chain: [['vllm', 'vllm-dc1', 'qwen3-32b'], ['hiwar-local', 'hiwar-local-cluster', 'hiwar-local-reasoning']], agents: 1 },
];
