// src/standalone/dsh-plugin.ts
import * as crypto from "node:crypto";
import * as http2 from "node:http";
import * as os3 from "node:os";
import * as path4 from "node:path";
import { StringDecoder } from "node:string_decoder";

// src/proxy.ts
import * as http from "http";
import { Readable } from "stream";

// src/constants.ts
var FACTORY_API = "https://api.factory.ai";
var WORKOS_DEVICE_AUTHORIZE = "https://api.workos.com/user_management/authorize/device";
var WORKOS_TOKEN = "https://api.workos.com/user_management/authenticate";
var WORKOS_CLIENT_ID = "client_01HNM792M5G5G1A2THWPXKFMXB";
var DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
var FACTORY_CLIENT_VERSION = "0.238.0";
var FACTORY_HEADERS = {
  "X-Factory-Client": "cli",
  "X-Client-Version": FACTORY_CLIENT_VERSION,
  "User-Agent": `factory-cli/${FACTORY_CLIENT_VERSION}`
};
var FACTORY_LATEST_URL = "https://downloads.factory.ai/factory-cli/LATEST";
function compareVersions(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}
/** Adopt a newer droid CLI version string (never downgrades). */
function adoptFactoryClientVersion(v) {
  const ver = String(v ?? "").trim().replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(ver) || compareVersions(ver, FACTORY_CLIENT_VERSION) <= 0) return false;
  FACTORY_CLIENT_VERSION = ver;
  FACTORY_HEADERS["X-Client-Version"] = ver;
  FACTORY_HEADERS["User-Agent"] = `factory-cli/${ver}`;
  return true;
}
/** Track the current droid release so requests look like an up-to-date CLI. */
async function refreshFactoryClientVersion() {
  try {
    const res = await fetch(FACTORY_LATEST_URL, { signal: AbortSignal.timeout(1e4) });
    if (res.ok) adoptFactoryClientVersion(await res.text());
  } catch {
  }
  return FACTORY_CLIENT_VERSION;
}
var FACTORY_OPENAI_PLATFORM_ORG = "org-bHuLtG1fGmYk5YaOihAAXFBw";
var ANTHROPIC_VERSION = "2023-06-01";
var APP_API = "https://app.factory.ai";
var ANTHROPIC_BASE_PATH = "/api/llm/a";
var OPENAI_BASE_PATH = "/api/llm/o/v1";
function factoryApiForRegion(region) {
  if (!region || region === "global") {
    return FACTORY_API;
  }
  if (region.startsWith("http://") || region.startsWith("https://")) {
    return region;
  }
  if (region === "eu" || region === "europe") {
    return "https://api.eu.factory.ai";
  }
  return `https://api.${region}.factory.ai`;
}

// src/factory/models.ts
var MULTIPLIERS = {
  "claude-fable-5.1": 4,
  "claude-fable-5": 4,
  "claude-opus-5-5": 1.6,
  "claude-opus-5-5-fast": 3.2,
  "claude-opus-5": 2,
  "claude-opus-5-fast": 4,
  "claude-opus-4-8": 2,
  "claude-opus-4-8-fast": 4,
  "claude-opus-4-7": 2,
  "claude-opus-4-6": 2,
  "claude-opus-4-5-20251101": 2,
  "claude-sonnet-5-5": 0.8,
  "claude-sonnet-5": 0.8,
  "claude-sonnet-4-6": 1.2,
  "claude-sonnet-4-5-20250929": 1.2,
  "claude-haiku-4-5-20251001": 0.4,
  "gpt-6.1-sol": 0.8,
  "gpt-6-astra": 4,
  "gpt-6-sol": 0.8,
  "gpt-6-luna": 0.04,
  "gpt-5.6-sol": 1.6,
  // promo until 2026-11-22, then 2x
  "gpt-5.6-sol-fast": 3.2,
  // promo until 2026-11-22, then 4x
  "gpt-5.6-terra": 0.8,
  "gpt-5.6-luna": 0.08,
  "gpt-5.5": 2,
  "gpt-5.5-fast": 5,
  "gpt-5.5-pro": 12,
  "gpt-5.4": 1,
  "gpt-5.4-fast": 2,
  "gpt-5.4-mini": 0.3,
  "gpt-5.4-mini-fast": 0.6,
  "gpt-5.3-codex": 0.7,
  "gpt-5.3-codex-fast": 1.4,
  "gpt-5.2": 0.7,
  "gemini-3.1-pro-preview": 0.8,
  "gemini-3.8-flash": 0.3,
  "gemini-3.7-flash": 0.3,
  "gemini-3.6-flash": 0.6,
  "gemini-3.5-flash": 0.6,
  "gemini-3-flash-preview": 0.2,
  "grok-4.7": 0.8,
  "grok-4.6": 0.8,
  "grok-4.5": 0.8,
  inkling: 0.4,
  "mistral-large-4": 0.272,
  "mistral-medium-3.5": 0.6,
  "glm-5.3-flash": 0.06,
  "glm-5.3": 0.56,
  "glm-5.2": 0.56,
  "glm-5.2-fast": 0.84,
  "kimi-k3": 1.2,
  "kimi-k2.5": 0.25,
  "qwen3.8-max": 0.8,
  "nemotron-3-ultra": 0.24,
  "deepseek-v4.1-flash": 0.12,
  "deepseek-v4-flash-0731": 0.176,
  "deepseek-v4-pro": 0.528,
  "minimax-m3": 0.12,
  "minimax-m2.7": 0.12,
  "glm-5.1": 0.55
};
var FACTORY_MODELS = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", contextWindow: 2e5, maxTokens: 64e3, reasoning: true },
  { id: "claude-opus-5-5-fast", name: "Claude Opus 5.5 Fast", contextWindow: 2e5, maxTokens: 64e3, reasoning: true },
  { id: "claude-opus-5", name: "Claude Opus 5", contextWindow: 2e5, maxTokens: 64e3, reasoning: true },
  { id: "claude-opus-5-fast", name: "Claude Opus 5 Fast", contextWindow: 2e5, maxTokens: 64e3, reasoning: true },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", contextWindow: 2e5, maxTokens: 64e3, reasoning: true },
  { id: "claude-opus-4-8-fast", name: "Claude Opus 4.8 Fast", contextWindow: 2e5, maxTokens: 64e3, reasoning: true },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", contextWindow: 2e5, maxTokens: 64e3, reasoning: true },
  { id: "claude-opus-4-7-fast", name: "Claude Opus 4.7 Fast", contextWindow: 2e5, maxTokens: 64e3, reasoning: true },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", contextWindow: 2e5, maxTokens: 64e3, reasoning: true },
  { id: "claude-opus-4-6-fast", name: "Claude Opus 4.6 Fast", contextWindow: 2e5, maxTokens: 64e3, reasoning: true },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", contextWindow: 1e6, maxTokens: 128e3, reasoning: true },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextWindow: 2e5, maxTokens: 64e3, reasoning: true },
  { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5", contextWindow: 2e5, maxTokens: 64e3, reasoning: true },
  { id: "claude-fable-5", name: "Claude Fable 5", contextWindow: 867e3, maxTokens: 128e3, reasoning: true },
  { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", contextWindow: 2e5, maxTokens: 64e3, reasoning: true },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", contextWindow: 2e5, maxTokens: 32e3, reasoning: false },
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-6-sol", name: "GPT-6 Sol", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-6-astra", name: "GPT-6 Astra", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-6-luna", name: "GPT-6 Luna", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-5.6-sol-fast", name: "GPT-5.6 Sol Fast", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-5.5", name: "GPT-5.5", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-5.5-fast", name: "GPT-5.5 Fast", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-5.5-pro", name: "GPT-5.5 Pro", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-5.4-fast", name: "GPT-5.4 Fast", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-5.3-codex-fast", name: "GPT-5.3 Codex Fast", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "gpt-5.2", name: "GPT-5.2", contextWindow: 4e5, maxTokens: 128e3, reasoning: true },
  { id: "glm-5.3", name: "GLM 5.3", contextWindow: 104e4, maxTokens: 131072, reasoning: true },
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash", contextWindow: 104e4, maxTokens: 131072, reasoning: true },
  { id: "glm-5.2", name: "GLM 5.2", contextWindow: 104e4, maxTokens: 131072, reasoning: true },
  { id: "kimi-k3", name: "Kimi K3", contextWindow: 262144, maxTokens: 65536, reasoning: true },
  { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", contextWindow: 262144, maxTokens: 65536, reasoning: true },
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", contextWindow: 1048576, maxTokens: 65536, reasoning: true },
  { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash", contextWindow: 1048576, maxTokens: 65536, reasoning: true },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", contextWindow: 1048576, maxTokens: 65536, reasoning: true },
  { id: "minimax-m3", name: "MiniMax M3", contextWindow: 512e3, maxTokens: 64e3, reasoning: true },
  { id: "minimax-m2.7", name: "MiniMax M2.7", contextWindow: 196600, maxTokens: 64e3, reasoning: true },
  { id: "minimax-m2.5", name: "MiniMax M2.5", contextWindow: 204800, maxTokens: 64e3, reasoning: true },
  { id: "nemotron-3-ultra", name: "Nemotron 3 Ultra", contextWindow: 262144, maxTokens: 65536, reasoning: true },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", contextWindow: 1048576, maxTokens: 65536, reasoning: true },
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", contextWindow: 1048576, maxTokens: 65536, reasoning: true },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", contextWindow: 1048576, maxTokens: 65536, reasoning: true },
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", contextWindow: 1048576, maxTokens: 65536, reasoning: true },
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", contextWindow: 1048576, maxTokens: 65536, reasoning: true },
  { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", contextWindow: 1048576, maxTokens: 65536, reasoning: true },
  { id: "grok-4.7", name: "Grok 4.7", contextWindow: 256e3, maxTokens: 64e3, reasoning: true },
  { id: "grok-4.6", name: "Grok 4.6", contextWindow: 256e3, maxTokens: 64e3, reasoning: true },
  { id: "grok-4.5", name: "Grok 4.5", contextWindow: 256e3, maxTokens: 64e3, reasoning: true }
];
function familyOf(id) {
  if (id.startsWith("claude-")) return "anthropic";
  if (id.startsWith("gpt-") || id.endsWith("-codex")) return "openai-responses";
  // Grok: Factory only accepts x-api-provider "xai" on the Responses route.
  if (id.startsWith("grok-")) return "openai-responses";
  // Gemini: chat-completions with x-api-provider "google" (image models excluded).
  if (id.startsWith("gemini-") && !id.includes("-image")) return "openai-completions";
  if (id.startsWith("glm-") || id.startsWith("kimi-") || id.startsWith("deepseek-") || id.startsWith("minimax-") || id.startsWith("nemotron-")) {
    return "openai-completions";
  }
  return "unsupported";
}
function upstreamProviderFor(id) {
  if (id.startsWith("claude-")) return "anthropic";
  if (id.startsWith("gpt-") || id.endsWith("-codex")) return "openai";
  if (id.startsWith("gemini-")) return "google";
  if (id.startsWith("grok-")) return "xai";
  return "fireworks";
}

// src/factory/catalog.ts
var LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
function parseEfforts(cell) {
  const found = [];
  for (const m of cell.matchAll(/`([a-z]+)`/g)) {
    const v = m[1] === "none" ? "off" : m[1];
    if (LEVELS.includes(v) && !found.includes(v)) found.push(v);
  }
  return found.length ? found.sort((a, b) => LEVELS.indexOf(a) - LEVELS.indexOf(b)) : void 0;
}
var DOCS_URL = "https://docs.factory.ai/models.md";
async function fetchDocsCatalog() {
  try {
    const res = await fetch(DOCS_URL, { signal: AbortSignal.timeout(15e3) });
    if (!res.ok) return void 0;
    const md = await res.text();
    const out = /* @__PURE__ */ new Map();
    const row = /\|\s*([^|`]+?)\s*\|\s*`([a-z0-9][a-z0-9.\-_]*)`\s*\|\s*([0-9.]+)\s*×\s*\|([^|]+)\|/gi;
    let m;
    while (m = row.exec(md)) {
      const name2 = m[1].replace(/<[^>]+>/g, "").replace(/[*\\†‡^]+$/g, "").trim();
      out.set(m[2], {
        id: m[2],
        name: name2,
        multiplier: parseFloat(m[3]),
        efforts: parseEfforts(m[4])
      });
    }
    return out.size > 0 ? out : void 0;
  } catch {
    return void 0;
  }
}
function mergeCatalogIds(docs, extra = []) {
  const ids = /* @__PURE__ */ new Set();
  for (const m of FACTORY_MODELS) ids.add(m.id);
  if (docs) for (const id of docs.keys()) ids.add(id);
  for (const id of extra) ids.add(id);
  return [...ids].filter((id) => familyOf(id) !== "unsupported");
}
function defaultEfforts(id) {
  const fam = familyOf(id);
  if (fam === "unsupported") return void 0;
  if (id.startsWith("grok-")) return ["low", "medium", "high", "xhigh"];
  // Gemini 3 cannot disable thinking ("off" would silently mean default/high).
  if (id.startsWith("gemini-")) return ["low", "medium", "high"];
  if (fam === "openai-completions") return ["off", "high"];
  return ["off", "low", "medium", "high", "xhigh", "max"];
}
function entryFor(id, docs) {
  const d = docs?.get(id);
  if (d) return d.efforts ? d : { ...d, efforts: defaultEfforts(id) };
  const s = FACTORY_MODELS.find((m) => m.id === id);
  return {
    id,
    name: s?.name ?? id,
    multiplier: MULTIPLIERS[id],
    efforts: defaultEfforts(id)
  };
}

// src/util.ts
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function str(record, key) {
  const v = record[key];
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function num(record, key) {
  const v = record[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) {
    const p = Number(v);
    if (Number.isFinite(p)) return p;
  }
  return void 0;
}
function firstStr(record, keys) {
  for (const k of keys) {
    const v = str(record, k);
    if (v) return v;
  }
  return void 0;
}
function decodeBase64Url(segment) {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}
function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const parsed = JSON.parse(decodeBase64Url(parts[1]));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function orgIdFromJwt(token) {
  const p = decodeJwtPayload(token);
  if (!p) return void 0;
  return firstStr(p, [
    "external_org_id",
    "org_id",
    "organization_id",
    "organizationId",
    "orgId"
  ]);
}
function emailFromJwt(token) {
  const p = decodeJwtPayload(token);
  return p ? str(p, "email") : void 0;
}
function expFromJwt(token) {
  const p = decodeJwtPayload(token);
  const exp = p ? num(p, "exp") : void 0;
  return exp ? exp * 1e3 : void 0;
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || b.length === 0) return false;
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function randomId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function sha256Hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}
/** Deterministic RFC-4122-shaped (v5-style) UUID from a hex digest. */
function uuidFromHash(h) {
  const variant = (parseInt(h[16], 16) & 3 | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function errorMessage(e) {
  return e instanceof Error ? e.message : String(e);
}
/** Retry-After header (seconds or HTTP date) -> milliseconds. */
function parseRetryAfter(v) {
  if (!v) return void 0;
  const s = Number(v);
  if (Number.isFinite(s) && s >= 0) return s * 1e3;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : void 0;
}

// src/factory/transform.ts
var DROID_PREAMBLE = "You are Droid, an AI software engineering agent built by Factory.";
var SEP = "\n\n";
function textOfContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(isRecord).map((p) => typeof p.text === "string" ? p.text : "").filter((t) => t.length > 0).join("\n\n");
  }
  return "";
}
function ensureAnthropicSystem(body) {
  const sys = body.system;
  if (sys === void 0 || sys === null) {
    body.system = DROID_PREAMBLE;
    return;
  }
  if (typeof sys === "string") {
    if (!sys.startsWith(DROID_PREAMBLE)) body.system = `${DROID_PREAMBLE}${SEP}${sys}`;
    return;
  }
  if (Array.isArray(sys)) {
    const first = sys[0];
    if (isRecord(first) && first.type === "text" && typeof first.text === "string") {
      if (!first.text.startsWith(DROID_PREAMBLE)) {
        first.text = `${DROID_PREAMBLE}${SEP}${first.text}`;
      }
    } else {
      sys.unshift({ type: "text", text: DROID_PREAMBLE });
    }
    return;
  }
  body.system = DROID_PREAMBLE;
}
function ensureOpenAISystem(messages) {
  const texts = [];
  const rest = [];
  for (const m of messages) {
    if (isRecord(m) && (m.role === "system" || m.role === "developer")) {
      let t = textOfContent(m.content);
      if (t.startsWith(DROID_PREAMBLE)) t = t.slice(DROID_PREAMBLE.length).trim();
      if (t) texts.push(t);
    } else {
      rest.push(m);
    }
  }
  const content = texts.length > 0 ? `${DROID_PREAMBLE}${SEP}${texts.join(SEP)}` : DROID_PREAMBLE;
  return [{ role: "system", content }, ...rest];
}
// Gemini thought signatures (OpenAI-compatible route). Gemini returns a
// signature on its tool calls (tool_calls[].extra_content.google.thought_signature)
// and rejects the next turn with 400 if a replayed call lacks it. DSH's chat
// client does not round-trip extra_content, so the proxy remembers signatures
// from responses (keyed by tool-call id) and puts them back on replay, falling
// back to Google's documented skip value when unknown (e.g. after a restart).
var GEMINI_SIG_SKIP = "skip_thought_signature_validator";
var GEMINI_SIG_MAX = 4096;
var geminiSigs = /* @__PURE__ */ new Map();
function rememberGeminiSig(id, sig) {
  if (typeof id !== "string" || !id || typeof sig !== "string" || !sig || sig === GEMINI_SIG_SKIP) return;
  geminiSigs.delete(id);
  geminiSigs.set(id, sig);
  if (geminiSigs.size > GEMINI_SIG_MAX) geminiSigs.delete(geminiSigs.keys().next().value);
}
function sigOf(tc) {
  const g = isRecord(tc) && isRecord(tc.extra_content) && isRecord(tc.extra_content.google) ? tc.extra_content.google : void 0;
  return typeof g?.thought_signature === "string" && g.thought_signature ? g.thought_signature : void 0;
}
/** Fill in missing signatures on replayed assistant tool calls. Returns how many were real / fallback. */
function ensureGeminiThoughtSignatures(messages) {
  const n = { restored: 0, fallback: 0 };
  if (!Array.isArray(messages)) return n;
  for (const m of messages) {
    if (!isRecord(m) || m.role !== "assistant" || !Array.isArray(m.tool_calls)) continue;
    for (const tc of m.tool_calls) {
      if (!isRecord(tc) || sigOf(tc)) continue;
      const known = typeof tc.id === "string" ? geminiSigs.get(tc.id) : void 0;
      const extra = isRecord(tc.extra_content) ? tc.extra_content : {};
      tc.extra_content = { ...extra, google: { ...isRecord(extra.google) ? extra.google : {}, thought_signature: known ?? GEMINI_SIG_SKIP } };
      if (known) n.restored++;
      else n.fallback++;
    }
  }
  return n;
}
/**
 * Passive tap on a Gemini chat response (SSE or JSON) that records tool-call
 * signatures. Never alters the bytes; parsing failures are ignored.
 */
var GeminiSigTap = class {
  constructor(sse) {
    this.sse = sse;
    this.decoder = new StringDecoder("utf8");
    this.buf = "";
    this.size = 0;
    this.ids = /* @__PURE__ */ new Map();
  }
  data(chunk) {
    const text = this.decoder.write(chunk);
    if (!this.sse) {
      this.size += text.length;
      if (this.size <= 16 * 1048576) this.buf += text;
      return;
    }
    this.buf += text;
    let nl;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).replace(/\r$/, "");
      this.buf = this.buf.slice(nl + 1);
      if (line.startsWith("data:") && line.includes("tool_calls")) this.chunk(line.slice(5).trim());
    }
  }
  end() {
    const rest = this.buf + this.decoder.end();
    this.buf = "";
    if (this.sse) {
      if (rest.startsWith("data:")) this.chunk(rest.slice(5).trim());
      return;
    }
    if (this.size > 16 * 1048576 || !rest.includes("tool_calls")) return;
    try {
      const j = JSON.parse(rest);
      for (const c of Array.isArray(j?.choices) ? j.choices : []) {
        for (const tc of Array.isArray(c?.message?.tool_calls) ? c.message.tool_calls : []) rememberGeminiSig(tc?.id, sigOf(tc));
      }
    } catch {
    }
  }
  chunk(data) {
    let j;
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    for (const c of Array.isArray(j?.choices) ? j.choices : []) {
      const calls = c?.delta?.tool_calls;
      if (!Array.isArray(calls)) continue;
      for (const tc of calls) {
        // streamed calls carry the id once; later fragments only carry the index
        const key = `${c.index ?? 0}:${tc?.index ?? 0}`;
        if (typeof tc?.id === "string" && tc.id) this.ids.set(key, tc.id);
        const sig = sigOf(tc);
        if (sig) rememberGeminiSig(this.ids.get(key), sig);
      }
    }
  }
};
function ensureResponsesBody(body) {
  const texts = [];
  if (typeof body.instructions === "string" && body.instructions.length > 0) {
    let inst = body.instructions;
    if (inst.startsWith(DROID_PREAMBLE)) inst = inst.slice(DROID_PREAMBLE.length).trim();
    if (inst) texts.push(inst);
  }
  if (Array.isArray(body.input)) {
    const rest = [];
    for (const item of body.input) {
      if (isRecord(item) && (item.role === "system" || item.role === "developer")) {
        const t = textOfContent(item.content);
        if (t) texts.push(t);
      } else {
        rest.push(item);
      }
    }
    body.input = rest;
  }
  const joined = texts.filter((t) => t.length > 0).join(SEP);
  body.instructions = joined ? `${DROID_PREAMBLE}${SEP}${joined}` : DROID_PREAMBLE;
}
function firstUserText(items) {
  if (typeof items === "string") return items;
  if (!Array.isArray(items)) return "";
  for (const m of items) {
    if (isRecord(m) && m.role === "user") return textOfContent(m.content);
  }
  return "";
}
/**
 * Stable per-conversation fingerprint: system prompt + first user turn stay
 * constant while a conversation grows, so every turn maps to the same key.
 * (Same idea as claude-relay-service / dsh-factory-provider session hashing.)
 */
function conversationKey(kind, body) {
  let sys = "";
  let first = "";
  if (kind === "anthropic") {
    sys = textOfContent(body.system);
    first = firstUserText(body.messages);
  } else if (kind === "chat") {
    const msgs = Array.isArray(body.messages) ? body.messages : [];
    sys = msgs.filter((m) => isRecord(m) && (m.role === "system" || m.role === "developer")).map((m) => textOfContent(m.content)).join(SEP);
    first = firstUserText(msgs);
  } else {
    sys = typeof body.instructions === "string" ? body.instructions : "";
    first = firstUserText(body.input);
  }
  if (!first) return void 0;
  return sha256Hex([kind, normalizeModel(body.model), sys, first].join("\0"));
}
var CACHE_EPHEMERAL = { type: "ephemeral" };
function cacheableBlock(b) {
  if (!isRecord(b) || b.cache_control) return false;
  if (b.type === "thinking" || b.type === "redacted_thinking") return false;
  if (b.type === "text" && !(typeof b.text === "string" && b.text.length > 0)) return false;
  return true;
}
/**
 * Add Anthropic prompt-cache breakpoints (end of system, end of the last
 * message) when the client sent none, so long agent loops re-read the shared
 * prefix from cache instead of paying full input price every turn.
 */
function injectAnthropicCache(body) {
  try {
    if (JSON.stringify(body).includes('"cache_control"')) return;
  } catch {
    return;
  }
  if (typeof body.system === "string" && body.system.length > 0) {
    body.system = [{ type: "text", text: body.system, cache_control: CACHE_EPHEMERAL }];
  } else if (Array.isArray(body.system) && body.system.length > 0) {
    const last = body.system[body.system.length - 1];
    if (cacheableBlock(last)) last.cache_control = CACHE_EPHEMERAL;
  }
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const lastMsg = msgs[msgs.length - 1];
  if (!isRecord(lastMsg)) return;
  if (typeof lastMsg.content === "string") {
    if (lastMsg.content.length > 0) lastMsg.content = [{ type: "text", text: lastMsg.content, cache_control: CACHE_EPHEMERAL }];
  } else if (Array.isArray(lastMsg.content) && lastMsg.content.length > 0) {
    const last = lastMsg.content[lastMsg.content.length - 1];
    if (cacheableBlock(last)) last.cache_control = CACHE_EPHEMERAL;
  }
}
/** Claude 5.x on the Factory gateway rejects enabled+budget thinking; it needs adaptive. */
function prefersAdaptiveThinking(model) {
  return /^claude-(opus|sonnet|haiku|fable)-5(\b|[-.])/.test(model);
}
function normalizeModel(raw) {
  const id = typeof raw === "string" ? raw : "";
  return id.replace(/^factory\//, "");
}
function isClaudeModel(model) {
  return /^claude[-_]/.test(model) || /^factory\/claude[-_]/.test(model);
}
function contentToBlocks(content) {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const p of content) {
    if (!isRecord(p)) continue;
    if (p.type === "text" || p.type === "output_text") {
      out.push({ type: "text", text: typeof p.text === "string" ? p.text : "" });
    } else if (p.type === "image_url" && isRecord(p.image_url)) {
      const url = String(p.image_url.url ?? "");
      const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(url);
      if (m) {
        out.push({
          type: "image",
          source: { type: "base64", media_type: m[1], data: m[2] }
        });
      } else if (url) {
        out.push({ type: "image", source: { type: "url", url } });
      }
    } else if (isRecord(p) && p.type === "tool_result") {
      out.push(p);
    }
  }
  return out;
}
function openaiChatToAnthropic(body) {
  const systemParts = [];
  const messages = [];
  for (const m of Array.isArray(body.messages) ? body.messages : []) {
    if (!isRecord(m)) continue;
    const role = m.role;
    if (role === "system" || role === "developer") {
      const t = textOfContent(m.content);
      if (t) systemParts.push(t);
      continue;
    }
    if (role === "tool") {
      const tr = {
        type: "tool_result",
        tool_use_id: m.tool_call_id ?? "",
        content: typeof m.content === "string" ? m.content : contentToBlocks(m.content)
      };
      const last = messages[messages.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content) && last.content.every((b) => isRecord(b) && b.type === "tool_result")) {
        last.content.push(tr);
      } else {
        messages.push({ role: "user", content: [tr] });
      }
      continue;
    }
    const blocks = contentToBlocks(m.content);
    if (role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc2 of m.tool_calls) {
        if (!isRecord(tc2)) continue;
        const fn = isRecord(tc2.function) ? tc2.function : {};
        blocks.push({
          type: "tool_use",
          id: tc2.id ?? "",
          name: fn.name ?? "",
          input: safeParseJson(fn.arguments)
        });
      }
    }
    messages.push({ role: role === "assistant" ? "assistant" : "user", content: blocks });
  }
  const out = {
    model: body.model,
    messages,
    max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : typeof body.max_completion_tokens === "number" ? body.max_completion_tokens : 8192
  };
  if (systemParts.length > 0) out.system = systemParts.join(SEP);
  if (body.stream === true) out.stream = true;
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  if (typeof body.top_p === "number") out.top_p = body.top_p;
  if (typeof body.stop === "string") out.stop_sequences = [body.stop];
  else if (Array.isArray(body.stop)) out.stop_sequences = body.stop;
  if (Array.isArray(body.tools)) {
    const tools = [];
    for (const t of body.tools) {
      if (!isRecord(t)) continue;
      const fn = t.type === "function" && isRecord(t.function) ? t.function : t;
      if (typeof fn.name !== "string") continue;
      tools.push({
        name: fn.name,
        description: typeof fn.description === "string" ? fn.description : "",
        input_schema: isRecord(fn.parameters) ? fn.parameters : { type: "object", properties: {} }
      });
    }
    if (tools.length > 0) out.tools = tools;
  }
  const tc = body.tool_choice;
  if (tc === "auto") out.tool_choice = { type: "auto" };
  else if (tc === "none") out.tool_choice = { type: "none" };
  else if (tc === "required") out.tool_choice = { type: "any" };
  else if (isRecord(tc)) {
    const name2 = isRecord(tc.function) ? tc.function.name : tc.name;
    if (typeof name2 === "string") out.tool_choice = { type: "tool", name: name2 };
  }
  return out;
}
function safeParseJson(v) {
  if (typeof v !== "string") return isRecord(v) || Array.isArray(v) ? v : {};
  try {
    return JSON.parse(v);
  } catch {
    return { _raw: v };
  }
}
function finishReason(stop) {
  if (stop === "end_turn" || stop === "stop_sequence") return "stop";
  if (stop === "tool_use") return "tool_calls";
  if (stop === "max_tokens") return "length";
  return null;
}
function anthropicToOpenAIChat(resp, model) {
  let text = "";
  const toolCalls = [];
  for (const b of Array.isArray(resp.content) ? resp.content : []) {
    if (!isRecord(b)) continue;
    if (b.type === "text") text += typeof b.text === "string" ? b.text : "";
    else if (b.type === "tool_use") {
      toolCalls.push({
        id: b.id ?? `call_${toolCalls.length}`,
        type: "function",
        function: { name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) }
      });
    }
  }
  const usage = isRecord(resp.usage) ? resp.usage : {};
  const inputT = Number(usage.input_tokens ?? 0);
  const outputT = Number(usage.output_tokens ?? 0);
  return {
    id: resp.id ?? "chatcmpl-bridge",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1e3),
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: text || null,
        ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {}
      },
      finish_reason: finishReason(resp.stop_reason) ?? "stop"
    }],
    usage: {
      prompt_tokens: inputT,
      completion_tokens: outputT,
      total_tokens: inputT + outputT
    }
  };
}
var AnthropicSseToChat = class {
  constructor(model) {
    this.model = model;
  }
  id = "chatcmpl-bridge";
  created = Math.floor(Date.now() / 1e3);
  roleSent = false;
  blockKind = /* @__PURE__ */ new Map();
  // content-block index -> kind
  toolIndex = /* @__PURE__ */ new Map();
  // content-block index -> tool_calls index
  toolCount = 0;
  chunk(delta, finish = null) {
    if (!this.roleSent) {
      this.roleSent = true;
      delta = { role: "assistant", ...delta };
    }
    const obj = {
      id: this.id,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finish }]
    };
    return `data: ${JSON.stringify(obj)}

`;
  }
  /** Translate one anthropic SSE data payload into OpenAI chunk frame(s). */
  event(dataJson) {
    if (dataJson === "[DONE]") return "";
    let ev;
    try {
      ev = JSON.parse(dataJson);
    } catch {
      return "";
    }
    const type = ev.type;
    let out = "";
    if (type === "message_start" && isRecord(ev.message)) {
      if (typeof ev.message.id === "string") this.id = ev.message.id;
      out += this.chunk({});
    } else if (type === "content_block_start" && isRecord(ev.content_block)) {
      const idx = Number(ev.index ?? 0);
      const cb = ev.content_block;
      if (cb.type === "tool_use") {
        this.blockKind.set(idx, "tool_use");
        this.toolIndex.set(idx, this.toolCount++);
        out += this.chunk({
          tool_calls: [{
            index: this.toolIndex.get(idx),
            id: cb.id ?? "",
            type: "function",
            function: { name: cb.name ?? "", arguments: "" }
          }]
        });
      } else if (cb.type === "text") {
        this.blockKind.set(idx, "text");
        const t = typeof cb.text === "string" ? cb.text : "";
        if (t) out += this.chunk({ content: t });
      } else {
        this.blockKind.set(idx, String(cb.type ?? "other"));
      }
    } else if (type === "content_block_delta" && isRecord(ev.delta)) {
      const idx = Number(ev.index ?? 0);
      const d = ev.delta;
      if (d.type === "text_delta" && typeof d.text === "string") {
        out += this.chunk({ content: d.text });
      } else if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
        out += this.chunk({
          tool_calls: [{
            index: this.toolIndex.get(idx) ?? this.toolCount - 1,
            function: { arguments: d.partial_json }
          }]
        });
      } else if (d.type === "thinking_delta") {
        out += this.chunk({ reasoning_content: typeof d.thinking === "string" ? d.thinking : "" });
      }
    } else if (type === "message_delta" && isRecord(ev.delta)) {
      const fr = finishReason(ev.delta.stop_reason);
      if (fr) out += this.chunk({}, fr);
    } else if (type === "message_stop") {
      out += "data: [DONE]\n\n";
    } else if (type === "error") {
      const err = isRecord(ev.error) ? ev.error : {};
      out += `data: ${JSON.stringify({ error: { message: typeof err.message === "string" ? err.message : "upstream stream error", type: typeof err.type === "string" ? err.type : "server_error" } })}

`;
    }
    return out;
  }
};

// src/factory/api.ts
function endpoint(base) {
  return (base && base.length > 0 ? base : "https://api.factory.ai").replace(/\/+$/, "");
}
async function apiFetch(base, path5, accessToken, init = {}, orgId) {
  const headers = {
    ...FACTORY_HEADERS,
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    ...init.headers
  };
  if (orgId) headers["X-Factory-Org-Id"] = orgId;
  return fetch(`${endpoint(base)}${path5}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(3e4)
  });
}
function bucket(v) {
  if (!isRecord(v)) return void 0;
  const usedPercent = num(v, "usedPercent");
  if (usedPercent === void 0) return void 0;
  const windowEnd = str(v, "windowEnd");
  let parsed = windowEnd ? Date.parse(windowEnd) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    const secs = num(v, "secondsRemaining");
    if (secs !== void 0 && secs >= 0) parsed = Date.now() + secs * 1e3;
  }
  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetsAt: Number.isFinite(parsed) ? parsed : void 0
  };
}
var QUOTA_WINDOWS = ["standard5h", "standardWeekly", "standardMonthly", "core5h", "coreWeekly", "coreMonthly"];
/** A window whose reset time has passed is idle again: report it as 0% used. */
function liveQuota(q, now = Date.now()) {
  if (!isRecord(q)) return q;
  let out = q;
  for (const k of QUOTA_WINDOWS) {
    const b = q[k];
    if (isRecord(b) && typeof b.resetsAt === "number" && b.resetsAt <= now) {
      if (out === q) out = { ...q };
      out[k] = { usedPercent: 0, resetsAt: void 0, expired: true };
    }
  }
  return out;
}
function hasQuotaData(q) {
  return isRecord(q) && QUOTA_WINDOWS.some((k) => isRecord(q[k]));
}
async function fetchQuota(base, accessToken, orgId) {
  const res = await apiFetch(base, "/api/billing/limits", accessToken, {}, orgId);
  const body = await res.text();
  if (!res.ok) {
    return { fetchedAt: Date.now(), error: `HTTP ${res.status}: ${body.slice(0, 120)}` };
  }
  try {
    const data = JSON.parse(body);
    if (!isRecord(data)) return { fetchedAt: Date.now(), error: "unexpected payload" };
    const limits = isRecord(data.limits) ? data.limits : {};
    if (limits.notAvailable) {
      return { fetchedAt: Date.now(), planType: str(data, "planType"), notAvailable: true };
    }
    const standard = isRecord(limits.standard) ? limits.standard : {};
    const core = isRecord(limits.core) ? limits.core : {};
    return {
      fetchedAt: Date.now(),
      planType: str(data, "planType"),
      standard5h: bucket(standard.fiveHour),
      standardWeekly: bucket(standard.weekly),
      standardMonthly: bucket(standard.monthly),
      core5h: bucket(core.fiveHour),
      coreWeekly: bucket(core.weekly),
      coreMonthly: bucket(core.monthly),
      extraUsageBalanceCents: num(data, "extraUsageBalanceCents")
    };
  } catch (e) {
    return { fetchedAt: Date.now(), error: errorMessage(e) };
  }
}
async function appFetch(path5, accessToken, init = {}, orgId) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...init.headers
  };
  if (orgId) headers["X-Factory-Org-Id"] = orgId;
  return fetch(`${APP_API}${path5}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(3e4)
  });
}
async function createPersonalApiKey(accessToken, orgId, keyName) {
  const res = await appFetch(
    "/api/factory-api-key/create",
    accessToken,
    { method: "POST", body: JSON.stringify({ name: keyName }) },
    orgId
  );
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`create api key failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = JSON.parse(body);
  const value = isRecord(data) ? str(data, "value") : void 0;
  const id = isRecord(data) ? str(data, "id") : void 0;
  if (!value || !id) throw new Error("create api key returned no key value");
  return { id, value, fingerprint: isRecord(data) ? str(data, "fingerprint") : void 0 };
}

// src/standalone/dashboard.ts
var DASHBOARD_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>vwFactory</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box;margin:0}
  :root{
    --bg:#0b0d12;--card:#151924;--card2:#1a1f2d;--line:#262c3a;
    --fg:#e8ebf4;--dim:#8b93a7;--acc:#5b8cff;--acc2:#7c5bff;
    --ok:#3ddc97;--warn:#f5b454;--bad:#f0694f;
    --sh:0 6px 20px rgba(0,0,0,.3);--r:12px;
  }
  [data-theme=light]{
    --bg:#f2f4f9;--card:#ffffff;--card2:#f4f7fc;--line:#e2e7f0;
    --fg:#1d2330;--dim:#68738a;--acc:#4a7dff;--acc2:#7a5cf5;
    --ok:#16a571;--warn:#d98a1f;--bad:#e04f38;
    --sh:0 4px 18px rgba(31,45,80,.09);
  }
  body{background:var(--bg);color:var(--fg);font:13px/1.55 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
    transition:background .35s,color .35s;min-height:100vh}
  body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
    background:radial-gradient(560px 260px at 15% -6%,color-mix(in srgb,var(--acc) 13%,transparent),transparent 70%),
               radial-gradient(460px 220px at 92% 0%,color-mix(in srgb,var(--acc2) 11%,transparent),transparent 70%)}
  .wrap{position:relative;max-width:720px;margin:0 auto;padding:30px 18px 50px}

  /* ---------- header ---------- */
  header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px}
  .logo{display:flex;align-items:center;gap:10px}
  .mark{width:32px;height:32px;border-radius:9px;flex:none;
    background:linear-gradient(135deg,var(--acc),var(--acc2));
    display:grid;place-items:center;font-weight:800;color:#fff;font-size:15px;
    box-shadow:0 3px 12px color-mix(in srgb,var(--acc) 40%,transparent)}
  h1{font-size:18px;font-weight:700;letter-spacing:.3px}
  h1 b{background:linear-gradient(90deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent}
  .statline{color:var(--dim);font-size:11.5px;margin-left:42px}
  .hctl{display:flex;align-items:center;gap:10px}
  .iconbtn{width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:var(--card);
    display:grid;place-items:center;cursor:pointer;font-size:13px;color:var(--fg);transition:.2s}
  .iconbtn:hover{border-color:var(--acc);transform:translateY(-1px)}

  /* ---------- switch ---------- */
  .switch{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--dim);cursor:pointer;user-select:none}
  .sw{position:relative;width:34px;height:19px;border-radius:10px;background:var(--card2);
    border:1px solid var(--line);transition:.25s;flex:none}
  .sw::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;
    background:var(--dim);transition:.25s cubic-bezier(.34,1.56,.64,1)}
  input:checked+.sw{background:color-mix(in srgb,var(--acc) 25%,var(--card2));border-color:var(--acc)}
  input:checked+.sw::after{left:17px;background:var(--acc);box-shadow:0 0 8px color-mix(in srgb,var(--acc) 60%,transparent)}
  input[type=checkbox]{display:none}

  /* ---------- compact account card ---------- */
  .card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:11px 14px;
    margin-bottom:9px;box-shadow:var(--sh);position:relative;overflow:hidden;
    display:flex;align-items:center;gap:14px;
    transition:border-color .25s,transform .2s;animation:rise .4s cubic-bezier(.22,.9,.3,1) backwards}
  .card:hover{transform:translateY(-1px)}
  .card.on{border-color:color-mix(in srgb,var(--ok) 45%,var(--line))}
  .card.on::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;
    background:linear-gradient(180deg,var(--ok),transparent)}
  @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  .who{display:flex;align-items:center;gap:10px;min-width:0;flex:0 1 240px}
  .avt{width:30px;height:30px;border-radius:8px;flex:none;display:grid;place-items:center;font-weight:700;font-size:13px;color:#fff}
  .email{font-weight:600;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}
  .meta{color:var(--dim);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .badge{font-size:10px;border-radius:14px;padding:1px 8px;white-space:nowrap;border:1px solid var(--line);color:var(--dim)}
  .badge.on{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 50%,transparent);background:color-mix(in srgb,var(--ok) 9%,transparent)}
  .badge.on::before{content:"\u25CF";margin-right:4px;font-size:8px;animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}

  /* ---------- compact quota: two rows of three mini donuts ---------- */
  .qzone{flex:1;display:flex;flex-direction:column;gap:5px;min-width:0}
  .qrow{display:flex;gap:6px;align-items:center}
  .qrow .glab{font-size:9px;color:var(--dim);width:30px;flex:none;letter-spacing:.5px}
  .donut{position:relative;width:38px;height:38px;flex:none}
  .donut svg{transform:rotate(-90deg)}
  .donut circle{fill:none;stroke-width:4;stroke-linecap:round}
  .donut .bg{stroke:var(--line)}
  .donut .fg{stroke:var(--acc);transition:stroke-dashoffset .9s cubic-bezier(.22,.9,.3,1),stroke .3s}
  .donut .val{position:absolute;inset:0;display:grid;place-items:center;font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums}
  .donut .name{position:absolute;left:50%;transform:translateX(-50%);bottom:-11px;font-size:8.5px;color:var(--dim);white-space:nowrap}
  .qrow{margin-bottom:9px}
  .qrow:last-child{margin-bottom:0}
  .donut.warn .fg{stroke:var(--warn)} .donut.warn .val{color:var(--warn)}
  .donut.full .fg{stroke:var(--bad)} .donut.full .val{color:var(--bad)}
  .noquota{color:var(--dim);font-size:11px}
  .qerr{color:var(--bad);font-size:11px}

  /* ---------- buttons ---------- */
  .actions{display:flex;gap:6px;flex:none}
  button{font:inherit;font-size:11.5px;padding:5px 12px;border:1px solid var(--line);border-radius:8px;
    background:var(--card2);color:var(--fg);cursor:pointer;transition:.18s;white-space:nowrap}
  button:hover{border-color:var(--acc);color:var(--acc)}
  button.pri{background:linear-gradient(135deg,var(--acc),var(--acc2));border:none;color:#fff;font-weight:600}
  button.pri:hover{filter:brightness(1.12);color:#fff}
  button.danger{padding:5px 9px}
  button.danger:hover{border-color:var(--bad);color:var(--bad)}
  .hbtn{font-size:11.5px;padding:5px 12px;border-radius:8px}

  /* ---------- right drawer (models) ---------- */
  .dmask{position:fixed;inset:0;background:rgba(8,10,15,.45);backdrop-filter:blur(2px);
    z-index:48;opacity:0;pointer-events:none;transition:opacity .25s}
  .dmask.open{opacity:1;pointer-events:auto}
  .drawer{position:fixed;top:0;right:0;bottom:0;width:min(400px,92vw);z-index:49;
    background:var(--card);border-left:1px solid var(--line);
    box-shadow:-18px 0 50px rgba(0,0,0,.28);padding:18px 18px 14px;
    display:flex;flex-direction:column;transform:translateX(105%);
    transition:transform .38s cubic-bezier(.22,.9,.3,1)}
  .drawer.open{transform:none}
  .drawer .mgrid{flex:1;max-height:none;align-content:flex-start;margin-top:10px}

  /* ---------- add-account modal ---------- */
  .amask{position:fixed;inset:0;background:rgba(8,10,15,.55);backdrop-filter:blur(3px);
    z-index:50;display:grid;place-items:center;opacity:0;pointer-events:none;transition:opacity .22s}
  .amask.open{opacity:1;pointer-events:auto}
  .amask .modal{width:430px;transform:scale(.92) translateY(8px);opacity:0;
    transition:transform .3s cubic-bezier(.34,1.4,.64,1),opacity .22s}
  .amask.open .modal{transform:none;opacity:1}
  textarea{width:100%;min-height:84px;resize:vertical;font:inherit;font-size:12px;padding:9px 11px;
    border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--fg);outline:none;
    font-family:ui-monospace,Consolas,monospace;line-height:1.7;transition:border-color .2s}
  textarea:focus{border-color:var(--acc)}
  input[type=text],input[type=password]{font:inherit;font-size:12.5px;padding:7px 11px;border:1px solid var(--line);
    border-radius:8px;background:var(--card2);color:var(--fg);outline:none;transition:border-color .2s}
  input:focus{border-color:var(--acc)}
  .hint{font-size:11px;color:var(--dim);margin-top:7px}
  .addrow{display:flex;gap:8px;margin-top:9px;justify-content:flex-end}

  /* ---------- footer / toast / modal ---------- */
  .foot{margin-top:16px;color:var(--dim);font-size:11px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
  code{background:var(--card2);padding:1px 6px;border-radius:4px;font-family:ui-monospace,Consolas,monospace;font-size:10.5px}
  #toasts{position:fixed;top:16px;right:16px;z-index:60;display:flex;flex-direction:column;gap:8px}
  .toast{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--ok);border-radius:9px;
    padding:9px 14px;font-size:12px;box-shadow:var(--sh);animation:tin .3s cubic-bezier(.22,.9,.3,1);max-width:320px;white-space:pre-line}
  .toast.err{border-left-color:var(--bad)}
  .toast.out{animation:tout .25s forwards}
  @keyframes tin{from{opacity:0;transform:translateX(24px)}to{opacity:1}}
  @keyframes tout{to{opacity:0;transform:translateX(24px)}}
  .mask{position:fixed;inset:0;background:rgba(8,10,15,.55);backdrop-filter:blur(3px);z-index:50;
    display:grid;place-items:center;animation:fin .2s}
  @keyframes fin{from{opacity:0}}
  .modal{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;width:330px;
    box-shadow:var(--sh);animation:pop .28s cubic-bezier(.34,1.4,.64,1)}
  @keyframes pop{from{opacity:0;transform:scale(.92) translateY(8px)}}
  .modal h3{font-size:14px;margin-bottom:7px}
  .modal p{font-size:12px;color:var(--dim);margin-bottom:16px}
  .modal .row{display:flex;gap:9px;justify-content:flex-end}
  .empty{color:var(--dim);text-align:center;padding:32px 0;border:1.5px dashed var(--line);border-radius:var(--r);font-size:12.5px}
  .mgrid{display:flex;flex-wrap:wrap;gap:6px;max-height:260px;overflow-y:auto}
  .mchip{display:flex;align-items:baseline;gap:7px;background:var(--card2);border:1px solid var(--line);
    border-radius:8px;padding:4px 10px;font-size:11.5px;animation:rise .3s backwards}
  .mchip .mn{color:var(--fg)}
  .mchip .mm{font-weight:700;font-variant-numeric:tabular-nums}
  .mm.t0{color:var(--ok)} .mm.t1{color:var(--acc)} .mm.t2{color:var(--warn)} .mm.t3{color:var(--bad)}
  .mchip .fid{color:var(--dim);font-size:9.5px}

  #gate{max-width:380px;margin:14vh auto 0;text-align:center}
  #gate .card{padding:26px;display:block}
  #gate input{width:100%}
  #gmsg{font-size:12px;color:var(--bad);margin-top:10px;min-height:16px}
</style>
</head>
<body>
<div class="wrap">
<div id="gate">
  <div class="logo" style="justify-content:center"><div class="mark">v</div><h1>vw<b>Factory</b></h1></div>
  <div class="statline" style="margin:4px 0 18px">\u672C\u5730\u591A\u8D26\u53F7\u7BA1\u7406\u9762\u677F</div>
  <div class="card">
    <div style="font-size:12px;color:var(--dim);margin-bottom:10px">\u9700\u8981\u672C\u673A\u4EE3\u7406\u4EE4\u724C\uFF08fbk-\u2026\uFF09</div>
    <input id="tok" type="password" placeholder="\u7C98\u8D34 fbk- \u4EE4\u724C" onkeydown="if(event.key==='Enter')saveTok()">
    <button class="pri" style="width:100%;margin-top:9px" onclick="saveTok()">\u8FDE\u63A5</button>
    <div id="gmsg"></div>
  </div>
</div>

<div id="main" hidden>
  <header>
    <div class="logo"><div class="mark">v</div><div><h1>vw<b>Factory</b></h1><div class="statline" id="statline" style="margin:0"></div></div></div>
    <div class="hctl">
      <button class="hbtn" onclick="toggleModels()">\u26A1 \u6A21\u578B</button>
      <button class="hbtn" onclick="openAdd()">\uFF0B \u6DFB\u52A0\u8D26\u53F7</button>
      <button class="hbtn" onclick="refreshQuota(this)">\u21BB \u5237\u65B0\u989D\u5EA6</button>
      <button class="hbtn" onclick="exportAll(this)">\u2913 \u5BFC\u51FA</button>
      <label class="switch" title="\u989D\u5EA6\u7528\u5C3D / \u9274\u6743\u5931\u8D25\u65F6\u81EA\u52A8\u5207\u6362\u5230\u7528\u91CF\u6700\u4F4E\u7684\u8D26\u53F7">
        <span>\u81EA\u52A8\u5207\u53F7</span>
        <input type="checkbox" id="asw" onchange="setAsw(this.checked)"><span class="sw"></span>
      </label>
      <div class="iconbtn" title="\u5207\u6362\u4E3B\u9898" onclick="theme()"><span id="thic">\u263E</span></div>
    </div>
  </header>

  <div id="list"></div>

</div>

<!-- add-account modal -->
<div class="amask" id="addmask" onclick="if(event.target===this)closeAdd()">
  <div class="modal">
    <h3>\u6DFB\u52A0\u8D26\u53F7</h3>
    <textarea id="bulk" placeholder="\u652F\u6301\u6279\u91CF\uFF0C\u6BCF\u884C\u4E00\u4E2A\uFF1A\u90AE\u7BB1----API Key&#10;\u4F8B\u5982\uFF1A&#10;me@a.com----fk-xxxxxxxx&#10;me@b.com----fk-yyyyyyyy"></textarea>
    <div class="addrow">
      <input id="borg" type="text" placeholder="\u7EC4\u7EC7 ID\uFF08\u53EF\u9009\uFF0C\u5E94\u7528\u4E8E\u5168\u90E8\uFF09" style="width:190px">
      <button class="pri" onclick="add()">\u6DFB\u52A0</button>
    </div>
    <div class="hint">\u5206\u9694\u7B26\u662F\u56DB\u4E2A\u8FDE\u5B57\u7B26 <code>----</code>\u3002\u53EA\u5B58\u90AE\u7BB1\u548C key\uFF0C\u7528\u4E8E\u6807\u8BC6\u548C\u8BA1\u8D39\u3002</div>
  </div>
</div>

<!-- models drawer -->
<div class="dmask" id="dmask" onclick="closeDrawer()"></div>
<aside class="drawer" id="drawer">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:13px;font-weight:650">\u6A21\u578B\u76EE\u5F55 \xB7 \u6D88\u8017\u500D\u7387</span>
    <input id="mq" type="text" placeholder="\u641C\u7D22\u6A21\u578B\u2026" style="width:150px" oninput="renderModels()">
  </div>
  <div id="mgrid" class="mgrid"></div>
  <div class="hint">\u500D\u7387 = \u6BCF\u5B9E\u9645 token \u6D88\u8017\u7684\u6807\u51C6 token \u6570\uFF08\u7F13\u5B58\u547D\u4E2D\u518D \xD70.1\uFF09\u3002\u6570\u636E\u6765\u81EA\u5B98\u65B9\u6587\u6863 docs.factory.ai/models\u3002</div>
</aside>

<div class="wrap">

  <div class="foot">
    <span id="stamp"></span>
    <span>\u63A5\u5165 \u2014 OpenAI \u517C\u5BB9\uFF1A<code id="b1"></code> \xB7 Key \u586B\u672C\u673A\u4EE4\u724C\uFF08fbk-\u2026\uFF09</span>
  </div>
</div>
</div>
<div id="toasts"></div>
<div id="modalRoot"></div>

<script>
const $=id=>document.getElementById(id);
let T=localStorage.getItem('fb.token')||'';
document.getElementById('b1').textContent=location.origin+'/v1';
document.documentElement.dataset.theme=localStorage.getItem('fb.theme')||'dark';
$('thic').textContent=document.documentElement.dataset.theme==='light'?'\u2600':'\u263E';

function theme(){const d=document.documentElement.dataset;
  d.theme=d.theme==='light'?'dark':'light';localStorage.setItem('fb.theme',d.theme);
  $('thic').textContent=d.theme==='light'?'\u2600':'\u263E'}

function toast(m,err){const t=document.createElement('div');t.className='toast'+(err?' err':'');t.textContent=m;
  $('toasts').appendChild(t);setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),260)},3800)}

async function api(p,m,b){
  const r=await fetch(p,{method:m||'GET',headers:{Authorization:'Bearer '+T,'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});
  if(r.status===401){$('gate').hidden=false;$('main').hidden=true;$('gmsg').textContent='\u4EE4\u724C\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u8F93\u5165';throw new Error('401')}
  return r.json();
}
function saveTok(){T=$('tok').value.trim();localStorage.setItem('fb.token',T);$('gmsg').textContent='';boot()}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

/* mini donut: circumference for r=15.5 \u2248 97.4 (svg 38px) */
const C=2*Math.PI*15.5;
function donut(p,name){
  const cls=p>=90?'full':p>=70?'warn':'';
  const off=(C*(1-Math.min(100,Math.max(0,p))/100)).toFixed(1);
  return '<div class="donut '+cls+'"><svg width="38" height="38">'
    +'<circle class="bg" cx="19" cy="19" r="15.5"/>'
    +'<circle class="fg" cx="19" cy="19" r="15.5" stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+C.toFixed(1)+'" data-off="'+off+'"/>'
    +'</svg><span class="val">'+Math.round(p)+'%</span><span class="name">'+name+'</span></div>';
}
function quotaHtml(q){
  if(!q)return '<div class="noquota">\u6682\u65E0\u989D\u5EA6 \u2014 \u70B9\u53F3\u4E0A\u300C\u5237\u65B0\u989D\u5EA6\u300D</div>';
  if(q.error)return '<div class="qerr">\u989D\u5EA6\u83B7\u53D6\u5931\u8D25</div>';
  const std=[],core=[];
  if(q.standard5h)std.push(donut(q.standard5h.usedPercent,'5h'));
  if(q.standardWeekly)std.push(donut(q.standardWeekly.usedPercent,'\u5468'));
  if(q.standardMonthly)std.push(donut(q.standardMonthly.usedPercent,'\u6708'));
  if(q.core5h)core.push(donut(q.core5h.usedPercent,'5h'));
  if(q.coreWeekly)core.push(donut(q.coreWeekly.usedPercent,'\u5468'));
  if(q.coreMonthly)core.push(donut(q.coreMonthly.usedPercent,'\u6708'));
  let h='<div class="qzone">';
  if(std.length)h+='<div class="qrow"><span class="glab" title="\u4E3B\u989D\u5EA6 \u2014 \u5168\u6A21\u578B\u901A\u7528\uFF0C\u4F18\u5148\u6D88\u8017">\u4E3B\u989D\u5EA6</span>'+std.join('')+'</div>';
  if(core.length)h+='<div class="qrow"><span class="glab" title="\u526F\u989D\u5EA6 \u2014 \u5F00\u6E90\u6A21\u578B(Core)\u4E13\u7528\u6C60\uFF0C\u4E3B\u989D\u5EA6\u7528\u5C3D\u540E\u542F\u7528">\u526F\u989D\u5EA6</span>'+core.join('')+'</div>';
  return h+'</div>';
}
const HUES=[214,262,288,174,24,340,196,140];
function avtColor(name){let h=0;for(const c of name)h=(h*31+c.charCodeAt(0))>>>0;
  return 'background:linear-gradient(135deg,hsl('+HUES[h%HUES.length]+' 70% 55%),hsl('+HUES[(h>>3)%HUES.length]+' 70% 42%))'}

async function load(){
  const s=await api('/api/state');
  $('gate').hidden=true;$('main').hidden=false;
  $('asw').checked=!!s.autoSwitch;
  $('statline').textContent='127.0.0.1:4199 \xB7 '+s.identities.length+' \u4E2A\u8D26\u53F7';
  $('list').innerHTML=s.identities.map((i,idx)=>{
    const bits=[i.orgId?i.orgId.slice(0,12)+'\u2026':'',i.fingerprint?'\u2026'+i.fingerprint:''].filter(Boolean).join(' \xB7 ');
    return '<div class="card'+(i.active?' on':'')+'" style="animation-delay:'+(idx*50)+'ms">'
      +'<div class="who"><div class="avt" style="'+avtColor(i.label||i.id)+'">'+esc((i.label||'?')[0].toUpperCase())+'</div>'
      +'<div style="min-width:0"><div><span class="email">'+esc(i.label||i.id)+'</span> '
      +'<span class="badge'+(i.active?' on':'')+'">'+(i.active?'\u4F7F\u7528\u4E2D':'\u5F85\u547D')+'</span></div>'
      +'<div class="meta">'+esc(bits)+'</div></div></div>'
      +quotaHtml(i.quota)
      +'<div class="actions">'
      +(i.active?'':'<button onclick="sw(\\''+i.id+'\\')">\u5207\u6362</button>')
      +'<button title="\u590D\u5236 \u90AE\u7BB1----Key" onclick="copyKey(this,\\''+i.id+'\\')">\u29C9</button>'
      +'<button title="\u5237\u65B0\u989D\u5EA6" onclick="refreshOne(this,\\''+i.id+'\\')">\u21BB</button>'
      +'<button class="danger" title="\u5220\u9664" onclick="askRm(\\''+i.id+'\\',\\''+esc(i.label||i.id).replace(/'/g,"\\\\'")+'\\')">\u2715</button>'
      +'</div></div>';
  }).join('')||'<div class="empty">\u8FD8\u6CA1\u6709\u8D26\u53F7<br><span style="font-size:11px">\u70B9\u53F3\u4E0A\u300C\uFF0B \u6DFB\u52A0\u8D26\u53F7\u300D\uFF0C\u586B\u5165 \u90AE\u7BB1----fk-Key</span></div>';
  const ts=s.identities.map(i=>i.quota&&i.quota.fetchedAt).filter(Boolean).sort().pop();
  $('stamp').textContent=ts?('\u989D\u5EA6\u66F4\u65B0\u4E8E '+new Date(ts).toLocaleString('zh-CN',{hour12:false})):'';
  requestAnimationFrame(()=>document.querySelectorAll('.donut .fg').forEach(c=>c.style.strokeDashoffset=c.dataset.off));
}

async function add(){
  const lines=$('bulk').value.split('\\n').map(l=>l.trim()).filter(Boolean);
  if(!lines.length){toast('\u8BF7\u6309 \u90AE\u7BB1----Key \u683C\u5F0F\u586B\u5199',1);return}
  const org=$('borg').value.trim()||undefined;
  let ok=0,fail=[];
  for(const l of lines){
    const p=l.split('----');
    const email=(p[0]||'').trim(),key=(p[1]||'').trim();
    if(!email||!key){fail.push(l.slice(0,30));continue}
    const r=await api('/api/add','POST',{email,api_key:key,org_id:org});
    if(r.error)fail.push(email+': '+r.error);else ok++;
  }
  toast('\u6210\u529F '+ok+' \u4E2A'+(fail.length?'\uFF0C\u5931\u8D25 '+fail.length+'\uFF1A\\n'+fail.join('\\n'):''),fail.length?1:0);
  if(ok){$('bulk').value='';if(!fail.length)closeAdd()}
  load();
}
async function sw(id){await api('/api/switch','POST',{id});toast('\u5DF2\u5207\u6362');load()}
function askRm(id,label){
  $('modalRoot').innerHTML='<div class="mask" onclick="if(event.target===this)closeM()"><div class="modal">'
    +'<h3>\u5220\u9664\u8D26\u53F7</h3><p>\u786E\u8BA4\u5220\u9664 <b style="color:var(--fg)">'+esc(label)+'</b>\uFF1F\u5176 API Key \u4E0E\u989D\u5EA6\u7F13\u5B58\u5C06\u4E00\u5E76\u79FB\u9664\uFF0C\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002</p>'
    +'<div class="row"><button onclick="closeM()">\u53D6\u6D88</button>'
    +'<button class="danger" style="border-color:var(--bad);color:var(--bad)" onclick="doRm(\\''+id+'\\')">\u786E\u8BA4\u5220\u9664</button></div></div></div>';
}
function closeM(){$('modalRoot').innerHTML=''}
async function doRm(id){closeM();await api('/api/remove','POST',{id});toast('\u5DF2\u5220\u9664');load()}
async function setAsw(v){await api('/api/failover','POST',{enabled:v});toast(v?'\u81EA\u52A8\u5207\u53F7\u5DF2\u5F00\u542F':'\u81EA\u52A8\u5207\u53F7\u5DF2\u5173\u95ED')}
async function refreshQuota(btn){const old=btn.textContent;btn.textContent='\u5237\u65B0\u4E2D\u2026';btn.disabled=true;
  try{const r=await api('/api/refresh','POST',{});toast(r.message||'\u5DF2\u5B8C\u6210');await load()}finally{btn.textContent=old;btn.disabled=false}}
async function refreshOne(btn,id){const old=btn.textContent;btn.textContent='\u2026';btn.disabled=true;
  try{const r=await api('/api/refresh','POST',{id});toast(r.message||'\u5DF2\u5B8C\u6210');await load()}finally{btn.textContent=old;btn.disabled=false}}
async function copyText(t,ok){try{await navigator.clipboard.writeText(t);toast(ok)}
  catch{const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();
    document.execCommand('copy');ta.remove();toast(ok)}}
async function copyKey(btn,id){const old=btn.textContent;btn.textContent='\u2026';btn.disabled=true;
  try{const r=await api('/api/export','POST',{id});
    if(r.error){toast(r.error,1)}else{await copyText(r.text,'\u5DF2\u590D\u5236 '+r.text.split('----')[0])}}
  finally{btn.textContent=old;btn.disabled=false}}
async function exportAll(btn){const old=btn.textContent;btn.textContent='\u5BFC\u51FA\u4E2D\u2026';btn.disabled=true;
  try{const r=await api('/api/export','POST',{});
    if(!r.text){toast('\u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u8D26\u53F7 key',1)}
    else{await copyText(r.text,'\u5DF2\u590D\u5236 '+r.count+' \u4E2A\u8D26\u53F7\uFF08\u90AE\u7BB1----Key\uFF09\u5230\u526A\u8D34\u677F')}}
  finally{btn.textContent=old;btn.disabled=false}}

function openAdd(){$('addmask').classList.add('open')}
function closeAdd(){$('addmask').classList.remove('open')}
function openDrawer(){$('drawer').classList.add('open');$('dmask').classList.add('open')}
function closeDrawer(){$('drawer').classList.remove('open');$('dmask').classList.remove('open')}

let MODELS=null;
function mtier(m){return m===null||m===undefined?'':m>=4?'t3':m>=1?'t1':m>=0.3?'t0':'t0'}
async function toggleModels(){
  if($('drawer').classList.contains('open')){closeDrawer();return}
  openDrawer();
  if(!MODELS){
    try{MODELS=(await api('/api/models')).models||[]}catch(e){MODELS=[]}
    renderModels();
  }
}
function renderModels(){
  const q=($('mq').value||'').toLowerCase();
  const list=(MODELS||[]).filter(m=>!q||m.id.toLowerCase().includes(q)||(m.name||'').toLowerCase().includes(q));
  $('mgrid').innerHTML=list.map(m=>
    '<div class="mchip" title="'+esc(m.id)+'"><span class="mn">'+esc(m.name)+'</span>'
    +(m.multiplier!==null&&m.multiplier!==undefined
      ?'<span class="mm '+mtier(m.multiplier)+'">'+m.multiplier+'\xD7</span>'
      :'<span class="mm" style="color:var(--dim)">\u2014</span>')
    +'</div>').join('')||'<div class="noquota">\u65E0\u5339\u914D\u6A21\u578B</div>';
}

let refreshed=false;
async function boot(){await load();if(!refreshed&&!$('main').hidden){refreshed=true;
  try{await api('/api/refresh','POST');await load()}catch(e){}}}
boot();
</script>
</body>
</html>`;

// src/proxy.ts
var SWITCHABLE_STATUS = /* @__PURE__ */ new Set([401, 402, 403, 429]);
// Gateway / provider hiccups: retried on the same account with backoff, then
// tried once on another account. They never bench an account (no cooldown).
var TRANSIENT_STATUS = /* @__PURE__ */ new Set([500, 502, 503, 504, 529]);
function envMs(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}
var TRANSIENT_RETRIES = envMs("VWFACTORY_RETRIES", 2);
var TRANSIENT_SWITCHES = 1;
// Streaming requests get response headers within seconds; a stalled gateway
// otherwise leaves DSH spinning forever. Non-streaming requests only return
// headers after the whole generation, so they get a much longer budget.
var FIRST_BYTE_TIMEOUT_MS = envMs("VWFACTORY_FIRST_BYTE_TIMEOUT_MS", 12e4);
var NONSTREAM_TIMEOUT_MS = envMs("VWFACTORY_NONSTREAM_TIMEOUT_MS", 15 * 6e4);
// Anthropic pings every ~15 s and OpenAI streams keep emitting, so 150 s of
// silence mid-stream means the connection is dead.
var IDLE_TIMEOUT_MS = envMs("VWFACTORY_IDLE_TIMEOUT_MS", 15e4);
var TimeoutError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "VwfTimeoutError";
  }
};
function sleepAbortable(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
/** Backoff before same-account retry #attempt (0-based): ~1 s, ~3 s, honouring Retry-After up to 20 s. */
function transientDelay(attempt, res) {
  const ra = parseRetryAfter(res?.headers?.get?.("retry-after"));
  if (ra !== void 0) return Math.min(ra, 2e4);
  return Math.round(1e3 * 3 ** attempt * (0.75 + Math.random() * 0.5));
}
/**
 * Wrap a fetch body so a read that stays silent for idleMs fails with a
 * TimeoutError (and aborts the upstream request). The timer only runs while
 * a read is pending, so a slow downstream consumer never trips it.
 */
function watchIdle(body, idleMs, abortUpstream) {
  if (!body || !(idleMs > 0)) return body;
  const reader = body.getReader();
  let failed = false;
  return new ReadableStream({
    async pull(c) {
      let timer;
      const idle = new Promise((_, reject) => {
        timer = setTimeout(() => {
          failed = true;
          reject(new TimeoutError(`vwFactory: upstream stream stalled (no data for ${Math.round(idleMs / 1e3)}s)`));
        }, idleMs);
      });
      try {
        const { done, value } = await Promise.race([reader.read(), idle]);
        if (done) c.close();
        else c.enqueue(value);
      } catch (e) {
        if (failed) {
          abortUpstream?.();
          reader.cancel(e).catch(() => {
          });
        }
        c.error(e);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel(reason) {
      return reader.cancel(reason).catch(() => {
      });
    }
  });
}
/** One protocol-native SSE error frame, so the client surfaces the failure instead of hanging. */
function sseErrorFrame(kind, message) {
  if (kind === "anthropic") return `event: error
data: ${JSON.stringify(anthropicError(message))}

`;
  if (kind === "responses") return `event: error
data: ${JSON.stringify({ type: "error", code: "server_error", message, param: null })}

`;
  return `data: ${JSON.stringify(openaiError(message))}

`;
}
var STICKY_TTL_MS = 60 * 6e4;
var BALANCE_MIGRATE_AT = 90;
var HOP_HEADERS = /* @__PURE__ */ new Set([
  "host",
  "connection",
  "content-length",
  "content-type",
  "accept",
  "transfer-encoding",
  "authorization",
  "x-api-key",
  "x-api-provider",
  "x-factory-org-id",
  "x-factory-client",
  "x-client-version",
  "x-session-id",
  "x-assistant-message-id",
  "user-agent",
  "accept-encoding"
]);
function anthropicError(message, type = "api_error") {
  return { type: "error", error: { type, message } };
}
function openaiError(message) {
  return { error: { message, type: "server_error" } };
}
var Emitter = class {
  listeners = [];
  event = (l) => {
    this.listeners.push(l);
    return { dispose: () => this.listeners.splice(this.listeners.indexOf(l), 1) };
  };
  fire(e) {
    for (const l of [...this.listeners]) l(e);
  }
};
function streamToText(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}
var FactoryProxy = class {
  constructor(store, cfg, hooks = {}) {
    this.store = store;
    this.cfg = cfg;
    this.hooks = hooks;
    this.gumloop = new GumloopRelay(this);
  }
  server;
  emitter = new Emitter();
  /** Fires with a human-readable note when the proxy auto-switches identity. */
  onDidAutoSwitch = this.emitter.event;
  get running() {
    return this.server !== void 0;
  }
  get port() {
    return this.cfg().get("vwFactory.proxy.port", 4199);
  }
  async start() {
    await this.stop();
    const port = this.port;
    this.server = http.createServer((req, res) => {
      void this.handle(req, res).catch((e) => {
        this.sendJson(res, 500, openaiError(errorMessage(e)));
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, "127.0.0.1", () => resolve());
    });
    void refreshFactoryClientVersion();
    if (!this.versionTimer) {
      this.versionTimer = setInterval(() => void refreshFactoryClientVersion(), 6 * 36e5);
      this.versionTimer.unref?.();
    }
    if (!this.quotaTimer) {
      this.quotaTimer = setInterval(() => void this.backgroundQuotaTick().catch(() => {
      }), 5 * 6e4);
      this.quotaTimer.unref?.();
    }
    if (!this.gumloopTimer) {
      this.gumloopTimer = setInterval(() => void this.gumloop.tick().catch(() => {
      }), 30 * 6e4);
      this.gumloopTimer.unref?.();
    }
  }
  async stop() {
    if (this.versionTimer) {
      clearInterval(this.versionTimer);
      this.versionTimer = void 0;
    }
    if (this.quotaTimer) {
      clearInterval(this.quotaTimer);
      this.quotaTimer = void 0;
    }
    if (this.gumloopTimer) {
      clearInterval(this.gumloopTimer);
      this.gumloopTimer = void 0;
    }
    if (!this.server) return;
    const s = this.server;
    this.server = void 0;
    await new Promise((resolve) => s.close(() => resolve()));
  }
  async readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  sendJson(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(data);
  }
  async authorized(req) {
    if (!this.cfg().get("vwFactory.proxy.requireAuth", true)) return true;
    const token = await this.store.proxyToken();
    const auth = req.headers.authorization;
    const apiKey = req.headers["x-api-key"];
    const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : void 0;
    return safeEqual(bearer, token) || safeEqual(typeof apiKey === "string" ? apiKey : void 0, token);
  }
  /**
   * Browser-request fence (DNS rebinding / cross-site). Returns a rejection
   * reason, or undefined when the request may proceed. Non-browser clients
   * (DSH, CLI tools) send a loopback Host and no Origin, so they always pass.
   */
  requestFence(req) {
    const port = this.port;
    const hosts = /* @__PURE__ */ new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
    const host = String(req.headers.host ?? "").toLowerCase();
    if (!hosts.has(host)) return "untrusted Host header";
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin !== "null" && !hosts.has(origin.toLowerCase().replace(/^http:\/\//, ""))) {
      return "cross-origin request";
    }
    if (origin === "null") return "opaque-origin request";
    const site = req.headers["sec-fetch-site"];
    const mode = req.headers["sec-fetch-mode"];
    if (site === "cross-site" && !(req.method === "GET" && mode === "navigate")) return "cross-site request";
    return void 0;
  }
  async resolveIdentity() {
    const meta = this.store.activeIdentity();
    if (!meta) return void 0;
    const cred = await this.store.upstreamCredential(meta);
    if (!cred) return void 0;
    return { meta, ...cred };
  }
  /** Whether failover to the next account is allowed right now. */
  async autoSwitchOn() {
    const store = this.store;
    if (store.autoSwitchEnabled) return store.autoSwitchEnabled();
    return this.cfg().get("vwFactory.proxy.autoSwitchOnError", true);
  }
  /** Pick the identity after `currentId` with the lowest known quota usage. */
  nextIdentity(exclude) {
    const skip = exclude instanceof Set ? exclude : new Set(exclude ? [exclude] : []);
    const list = this.store.identities().filter((i) => !skip.has(i.id) && !this.cooldownOf(i.id));
    if (list.length === 0) return void 0;
    const quotas = this.store.quotas();
    const usage = (id) => {
      const q = liveQuota(quotas[id]);
      if (!hasQuotaData(q)) return -1;
      return Math.max(...QUOTA_WINDOWS.map((k) => q[k]?.usedPercent ?? 0));
    };
    return list.sort((a, b) => usage(a.id) - usage(b.id))[0];
  }
  // ---- per-account cooldowns (in memory) ----
  // Cooldown table after claude-relay-service, except a 429 caused by an
  // exhausted quota window waits for that window's real reset time.
  cooldowns = /* @__PURE__ */ new Map();
  cooldownOf(id) {
    const c = this.cooldowns.get(id);
    if (!c) return void 0;
    if (c.until <= Date.now()) {
      this.cooldowns.delete(id);
      return void 0;
    }
    return c;
  }
  markCooldown(meta, res) {
    const now = Date.now();
    const status = res.status;
    let ms;
    let reason;
    if (status === 401 || status === 403) {
      ms = 30 * 6e4;
      reason = `HTTP ${status} auth rejected`;
    } else if (status === 402) {
      ms = 6 * 36e5;
      reason = "HTTP 402 payment required";
    } else if (status === 429) {
      reason = "HTTP 429 quota/rate limited";
      const q = liveQuota(this.store.quotas()[meta.id]);
      const resets = QUOTA_WINDOWS.map((k) => q?.[k]).filter((b) => isRecord(b) && b.usedPercent >= 100 && typeof b.resetsAt === "number" && b.resetsAt > now).map((b) => b.resetsAt);
      if (resets.length) ms = Math.min(...resets) - now;
      else {
        const ra = parseRetryAfter(res.headers?.get?.("retry-after"));
        ms = ra !== void 0 ? Math.min(Math.max(ra, 3e4), 30 * 6e4) : 5 * 6e4;
      }
    } else return;
    this.cooldowns.set(meta.id, { until: now + ms, reason, status });
  }
  /** Re-read one account's quota (throttled to once a minute). */
  async refreshQuotaFor(meta, minAgeMs = 6e4) {
    try {
      const prev = this.store.quotas()[meta.id];
      const last = Math.max(prev?.fetchedAt ?? 0, prev?.checkedAt ?? 0);
      if (Date.now() - last < minAgeMs) return;
      const cred = await this.store.upstreamCredential(meta);
      if (!cred) return;
      const q = await fetchQuota(cred.apiEndpoint ?? meta.apiEndpoint, cred.bearer, cred.orgId ?? meta.orgId);
      await this.store.saveQuota(meta.id, q);
    } catch {
    }
  }
  /** Before a request: move off an active account that is benched or out of standard quota. */
  async ensureUsableActive() {
    const meta = this.store.activeIdentity();
    if (!meta || !await this.autoSwitchOn()) return;
    const full = (id) => {
      const q = liveQuota(this.store.quotas()[id]);
      return ["standard5h", "standardWeekly", "standardMonthly"].some((k) => (q?.[k]?.usedPercent ?? 0) >= 100);
    };
    const cd = this.cooldownOf(meta.id);
    if (!cd && !full(meta.id)) return;
    const next = this.nextIdentity(meta.id);
    if (!next || full(next.id)) return;
    await this.store.setActive(next.id);
    this.store.pushAlert?.({ kind: "switch", from: meta.label, to: next.label, reason: cd ? String(cd.status) : "quota" });
    this.emitter.fire(`switched ${meta.label} -> ${next.label} (${cd ? cd.reason : "standard quota used up"})`);
  }
  // ---- session-sticky load balancing ----
  // Each conversation (fingerprint from conversationKey) stays on one account so
  // its prompt cache keeps hitting; new conversations go to the account with the
  // most standard quota left, penalised by in-flight requests and live sessions.
  // A conversation migrates only when its account is benched or crosses 90%
  // while a healthier account exists.
  sticky = /* @__PURE__ */ new Map();
  inflight = /* @__PURE__ */ new Map();
  lastAssigned = /* @__PURE__ */ new Map();
  lastRelayAt = 0;
  routingMode() {
    return this.store.routingMode?.() ?? "single";
  }
  stdWorst(id) {
    const q = liveQuota(this.store.quotas()[id]);
    if (!hasQuotaData(q)) return void 0;
    return Math.max(...["standard5h", "standardWeekly", "standardMonthly"].map((k) => q[k]?.usedPercent ?? 0));
  }
  pruneSticky(now = Date.now()) {
    for (const [k, v] of this.sticky) if (now - v.seen > STICKY_TTL_MS) this.sticky.delete(k);
    if (this.sticky.size > 5e3) {
      const old = [...this.sticky.entries()].sort((a, b) => a[1].seen - b[1].seen).slice(0, this.sticky.size - 5e3);
      for (const [k] of old) this.sticky.delete(k);
    }
  }
  sessionsOf(id, now = Date.now()) {
    let n = 0;
    for (const v of this.sticky.values()) if (v.id === id && now - v.seen <= STICKY_TTL_MS) n++;
    return n;
  }
  pickBalanced(exclude = /* @__PURE__ */ new Set()) {
    const cands = this.store.identities().filter((i) => !exclude.has(i.id) && !this.cooldownOf(i.id));
    if (cands.length === 0) return void 0;
    const healthy = cands.filter((i) => (this.stdWorst(i.id) ?? 0) < BALANCE_MIGRATE_AT);
    const pool = healthy.length ? healthy : cands;
    const score = (i) => 100 - (this.stdWorst(i.id) ?? 0) - 4 * (this.inflight.get(i.id) ?? 0) - 2 * this.sessionsOf(i.id);
    return pool.sort((a, b) => score(b) - score(a) || (this.lastAssigned.get(a.id) ?? 0) - (this.lastAssigned.get(b.id) ?? 0))[0];
  }
  async identityFor(meta) {
    const cred = await this.store.upstreamCredential(meta);
    return cred ? { meta, ...cred } : void 0;
  }
  bindSession(convKey, id) {
    const now = Date.now();
    this.lastAssigned.set(id, now);
    if (convKey) this.sticky.set(convKey, { id, seen: now });
  }
  /** Choose the account for one request (single mode = the active account). */
  async routeIdentity(convKey) {
    if (this.routingMode() !== "balance") {
      await this.ensureUsableActive();
      return this.resolveIdentity();
    }
    this.pruneSticky();
    const list = this.store.identities();
    let meta;
    const s = convKey ? this.sticky.get(convKey) : void 0;
    if (s) {
      const bound = list.find((i) => i.id === s.id);
      if (bound && !this.cooldownOf(bound.id)) {
        meta = bound;
        if ((this.stdWorst(bound.id) ?? 0) >= BALANCE_MIGRATE_AT) {
          const alt = this.pickBalanced(/* @__PURE__ */ new Set([bound.id]));
          if (alt && (this.stdWorst(alt.id) ?? 0) < BALANCE_MIGRATE_AT) meta = alt;
        }
      }
    }
    if (!meta) meta = this.pickBalanced();
    const identity = meta ? await this.identityFor(meta) : void 0;
    if (!identity) return this.resolveIdentity();
    this.bindSession(convKey, meta.id);
    return identity;
  }
  /** Count an in-flight request against an account until the response ends. */
  trackInflight(id, res) {
    this.inflight.set(id, (this.inflight.get(id) ?? 0) + 1);
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      const n = (this.inflight.get(id) ?? 1) - 1;
      if (n > 0) this.inflight.set(id, n);
      else this.inflight.delete(id);
    };
    res.once("close", release);
    res.once("finish", release);
  }
  /** Keep quota data fresh while the proxy is in use (balancing + alerts need it). */
  async backgroundQuotaTick() {
    if (Date.now() - this.lastRelayAt > 30 * 6e4) return;
    for (const meta of this.store.identities()) await this.refreshQuotaFor(meta, 4.5 * 6e4);
  }
  /**
   * On a switchable rejection, bench the account and retry on the remaining
   * accounts in order (least used first) until one answers or none are left.
   */
  async failover(identity, upstreamRes, send, convKey) {
    const tried = /* @__PURE__ */ new Set([identity.meta.id]);
    const balance = this.routingMode() === "balance";
    let transientSwitches = 0;
    while (await this.autoSwitchOn()) {
      const transient = TRANSIENT_STATUS.has(upstreamRes.status);
      if (!SWITCHABLE_STATUS.has(upstreamRes.status) && !(transient && transientSwitches < TRANSIENT_SWITCHES)) break;
      if (transient) transientSwitches++;
      else this.markCooldown(identity.meta, upstreamRes);
      if (upstreamRes.status === 429) void this.refreshQuotaFor(identity.meta);
      const next = balance ? this.pickBalanced(tried) ?? this.nextIdentity(tried) : this.nextIdentity(tried);
      if (!next) break;
      tried.add(next.id);
      const status = upstreamRes.status;
      const errText = await upstreamRes.text().catch(() => "");
      // A transient error is not the account's fault: borrow the next account
      // for this one request without changing the active account.
      if (!balance && !transient) await this.store.setActive(next.id);
      const retryIdentity = balance || transient ? await this.identityFor(next) : await this.resolveIdentity();
      let retryRes;
      if (retryIdentity) {
        try {
          retryRes = await send(retryIdentity);
        } catch {
        }
      }
      if (!retryRes) {
        return {
          identity,
          res: new Response(errText || JSON.stringify({ error: "upstream error" }), {
            status,
            headers: { "content-type": "application/json" }
          })
        };
      }
      this.emitter.fire(`${transient ? "borrowed" : "auto-switched"} ${identity.meta.label} -> ${next.label} (HTTP ${status} -> ${retryRes.status})`);
      if (retryRes.ok && !transient) {
        this.store.pushAlert?.({ kind: "switch", from: identity.meta.label, to: next.label, reason: String(status), balance });
        if (balance) this.bindSession(convKey, next.id);
      }
      identity = retryIdentity;
      upstreamRes = retryRes;
    }
    return { identity, res: upstreamRes };
  }
  // ---- live model catalog ----
  // Factory has no catalog API (droid ships its list in the binary), so we
  // scrape the public docs table for the universe of model ids + multipliers,
  // then probe each id against the gateway once a day; results persist in the
  // store so /v1/models only ever advertises models verified on this account.
  docsCache;
  catalogRefreshing = false;
  lastCatalogCheck = 0;
  modelCache() {
    const s = this.store;
    return s.modelCache?.() ?? { availability: {} };
  }
  async docsCatalog() {
    if (this.docsCache && Date.now() - this.docsCache.at < 6 * 36e5) {
      return this.docsCache.map;
    }
    const map = await fetchDocsCatalog();
    if (map) this.docsCache = { map, at: Date.now() };
    return this.docsCache?.map;
  }
  probeBody(id) {
    const fam = familyOf(id);
    if (fam === "anthropic") {
      return { kind: "anthropic", body: { model: id, max_tokens: 8, messages: [{ role: "user", content: "hi" }] } };
    }
    if (fam === "openai-responses") {
      return { kind: "responses", body: { model: id, input: "hi", max_output_tokens: 16 } };
    }
    return { kind: "chat", body: { model: id, max_tokens: 4, messages: [{ role: "user", content: "hi" }] } };
  }
  /** true = usable, false = definitively rejected, undefined = inconclusive. */
  async probeModel(id, identity) {
    const { kind, body } = this.probeBody(id);
    try {
      const res = await this.proxyOnce(kind, identity, body, {}, AbortSignal.timeout(2e4));
      if (res.status === 200) {
        void res.body?.cancel();
        return true;
      }
      const t = await res.text().catch(() => "");
      if (res.status === 404 || /invalid model|unknown model|does not exist|not supported|no longer available|not available in this region|deprecated/i.test(
        t
      )) {
        return false;
      }
      return void 0;
    } catch {
      return void 0;
    }
  }
  async refreshCatalog(force = false) {
    if (this.catalogRefreshing) return;
    const STALE = 24 * 36e5;
    const cache = this.modelCache();
    const known = Object.keys(cache.availability);
    const needsProbe = known.length === 0 || known.some((id) => Date.now() - cache.availability[id].at > STALE);
    const docsStale = !this.docsCache || Date.now() - this.docsCache.at > 6 * 36e5;
    if (!force && !needsProbe && !docsStale) return;
    this.catalogRefreshing = true;
    try {
      const docs = await this.docsCatalog();
      const ids = mergeCatalogIds(docs, Object.keys(cache.availability));
      const identity = await this.resolveIdentity();
      if (identity) {
        const now = Date.now();
        const stale = ids.filter(
          (id) => !cache.availability[id] || now - cache.availability[id].at > STALE
        );
        for (let i = 0; i < stale.length; i += 6) {
          await Promise.all(
            stale.slice(i, i + 6).map(async (id) => {
              const ok = await this.probeModel(id, identity);
              if (ok !== void 0) cache.availability[id] = { ok, at: now };
            })
          );
        }
      }
      if (docs) cache.catalogAt = Date.now();
      await this.store.saveModelCache?.(cache);
      this.lastCatalogCheck = Date.now();
      this.emitter.fire(`model catalog refreshed: ${this.availableIds().length} usable`);
    } finally {
      this.catalogRefreshing = false;
    }
  }
  availableIds() {
    const cache = this.modelCache();
    const ids = mergeCatalogIds(this.docsCache?.map, Object.keys(cache.availability));
    return ids.filter((id) => cache.availability[id]?.ok !== false);
  }
  /** Trigger a catalog refresh; awaited the very first time so early callers
   * see probe-verified results instead of the static list. */
  async kickCatalog() {
    const never = Object.keys(this.modelCache().availability).length === 0;
    if (never) await this.refreshCatalog(true);
    else void this.refreshCatalog();
  }
  /** Public: verified-usable catalog entries (id/name/family/multiplier/efforts). */
  async catalogEntries() {
    await this.kickCatalog();
    const docs = await this.docsCatalog();
    return this.availableIds().map((id) => {
      const e = entryFor(id, docs);
      return {
        id,
        name: e.name,
        family: familyOf(id),
        multiplier: e.multiplier,
        efforts: e.efforts
      };
    });
  }
  /**
   * Probe chat-route models that are in neither vision list with a test
   * image (at most `limit` per start) and remember the verdicts in
   * state.visionProbe, which syncPatchModels uses for `input: [text, image]`.
   * @returns the number of new verdicts.
   */
  async probeVision(entries, limit = 6) {
    const state = this.store.state;
    if (!state || typeof this.store.saveState !== "function") return 0;
    if (!isRecord(state.visionProbe)) state.visionProbe = {};
    Object.assign(VISION_PROBED, state.visionProbe);
    const todo = entries.filter((e) => providerKey(e.family, e.id) === "factory" && needsVisionProbe(e.id)).slice(0, limit);
    if (!todo.length || !this.store.activeIdentity?.()) return 0;
    const token = await this.store.proxyToken();
    let found = 0;
    for (const e of todo) {
      const ok = await probeVisionModel(this.port, token, e.id);
      if (ok === void 0) continue;
      state.visionProbe[e.id] = VISION_PROBED[e.id] = { ok, at: Date.now() };
      found++;
      console.info(`[vwFactory] image probe: ${e.id} -> ${ok ? "accepts images" : "text only"}`);
    }
    if (found) this.store.saveState();
    return found;
  }
  factoryHeaders(id, upstreamProvider, extra) {
    const headers = {
      ...FACTORY_HEADERS,
      Authorization: `Bearer ${id.bearer}`,
      "x-api-provider": upstreamProvider,
      "x-session-id": randomId("session"),
      "x-assistant-message-id": randomId("assistant"),
      ...extra
    };
    if (id.orgId) headers["X-Factory-Org-Id"] = id.orgId;
    return headers;
  }
  async upstream(url, headers, body, clientHeaders, abort, streaming = false) {
    const passthrough = {};
    for (const [k, v] of Object.entries(clientHeaders)) {
      if (typeof v === "string" && !HOP_HEADERS.has(k)) passthrough[k] = v;
    }
    // Per-attempt controller: follows the client abort, and also fires on our
    // own first-byte / idle timeouts without touching the client's signal.
    const ac = new AbortController();
    const onClientAbort = () => ac.abort(abort?.reason);
    if (abort?.aborted) ac.abort(abort.reason);
    else abort?.addEventListener("abort", onClientAbort, { once: true });
    const headerMs = streaming ? FIRST_BYTE_TIMEOUT_MS : NONSTREAM_TIMEOUT_MS;
    let timedOut = false;
    const timer = headerMs > 0 ? setTimeout(() => {
      timedOut = true;
      ac.abort(new TimeoutError(`vwFactory: upstream did not respond within ${Math.round(headerMs / 1e3)}s`));
    }, headerMs) : void 0;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          ...passthrough,
          ...headers,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream"
        },
        body,
        signal: ac.signal
      });
    } catch (e) {
      abort?.removeEventListener("abort", onClientAbort);
      if (timedOut) throw ac.signal.reason;
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!res.body || res.status < 200 || res.status > 599) return res;
    return new Response(watchIdle(res.body, IDLE_TIMEOUT_MS, () => ac.abort()), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers
    });
  }
  async proxyOnce(kind, id, body, clientHeaders, abort) {
    const base = (id.apiEndpoint || FACTORY_API).replace(/\/+$/, "");
    const model = normalizeModel(body.model);
    let url;
    let headers;
    if (kind === "anthropic") ensureAnthropicSystem(body);
    else if (kind === "chat") {
      if (Array.isArray(body.messages)) body.messages = ensureOpenAISystem(body.messages);
      if (upstreamProviderFor(model) === "google") ensureGeminiThoughtSignatures(body.messages);
    } else ensureResponsesBody(body);
    const conv = conversationKey(kind, body);
    const sessionId = conv ? uuidFromHash(sha256Hex(`${id.meta?.id ?? ""}\0${conv}`)) : crypto.randomUUID();
    if (kind === "anthropic") {
      injectAnthropicCache(body);
      url = `${base}${ANTHROPIC_BASE_PATH}/v1/messages`;
      headers = this.factoryHeaders(id, "anthropic", {
        "anthropic-version": ANTHROPIC_VERSION,
        "x-session-id": sessionId
      });
    } else if (kind === "chat") {
      url = `${base}${OPENAI_BASE_PATH}/chat/completions`;
      headers = this.factoryHeaders(id, upstreamProviderFor(model), { "x-session-id": sessionId });
    } else {
      if (body.prompt_cache_key === void 0 && upstreamProviderFor(model) === "openai") body.prompt_cache_key = sessionId;
      url = `${base}${OPENAI_BASE_PATH}/responses`;
      const respProvider = upstreamProviderFor(model);
      // The OpenAI-Platform header makes the gateway 403 non-OpenAI (xai) requests.
      headers = this.factoryHeaders(id, respProvider, respProvider === "openai" ? {
        "OpenAI-Platform": FACTORY_OPENAI_PLATFORM_ORG,
        "x-session-id": sessionId
      } : { "x-session-id": sessionId });
    }
    return this.upstream(url, headers, JSON.stringify(body), clientHeaders, abort, body.stream === true);
  }
  /**
   * proxyOnce plus same-account retries for transient failures (network
   * errors, timeouts, 5xx/529) with jittered backoff. Throws only when the
   * last attempt still fails at the network level.
   */
  async proxyRetrying(kind, id, body, clientHeaders, abort) {
    for (let attempt = 0; ; attempt++) {
      let res;
      let err;
      try {
        res = await this.proxyOnce(kind, id, body, clientHeaders, abort);
      } catch (e) {
        if (abort?.aborted) throw e;
        err = e;
      }
      if (res && !TRANSIENT_STATUS.has(res.status)) return res;
      // A timed-out attempt already cost minutes: retry it at most once.
      const max = err instanceof TimeoutError ? Math.min(1, TRANSIENT_RETRIES) : TRANSIENT_RETRIES;
      if (attempt >= max || abort?.aborted) {
        if (res) return res;
        throw err;
      }
      const wait = transientDelay(attempt, res);
      this.emitter.fire(`retrying ${id.meta?.label ?? "account"} in ${wait}ms (${res ? `HTTP ${res.status}` : errorMessage(err)})`);
      await res?.body?.cancel().catch(() => {
      });
      await sleepAbortable(wait, abort);
      if (abort?.aborted) {
        if (res) return res;
        throw err;
      }
    }
  }
  // ---- MCP (Model Context Protocol) endpoint: /mcp ----
  // Streamable-HTTP JSON-RPC, stateless (no session id). Lets clients like
  // Devin CLI / Windsurf call Factory models as tools through this proxy.
  mcpTools() {
    return [
      {
        name: "factory_models",
        description: "List the models available on the Factory account routed by vwFactory.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "factory_status",
        description: "Show the active vwFactory identity, organization, and quota usage summary.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "factory_accounts",
        description: "List all Factory identities configured in vwFactory (accounts/orgs), marking which is active, with key fingerprint and quota when known.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "factory_switch",
        description: "Switch the active Factory identity used for all upstream requests (affects every client of this proxy). Pass an identity label, org id, or substring.",
        inputSchema: {
          type: "object",
          properties: {
            identity: {
              type: "string",
              description: "Identity label, email, org id, or unique substring to switch to."
            }
          },
          required: ["identity"]
        }
      },
      {
        name: "factory_chat",
        description: "Send a single-turn prompt to a Factory model through vwFactory (uses the active identity and automatic account failover). Returns the model's text reply.",
        inputSchema: {
          type: "object",
          properties: {
            model: {
              type: "string",
              description: "Factory model id, e.g. deepseek-v4-pro, claude-sonnet-4-6, gpt-5.5. Optional; defaults to the bridge's configured chat model."
            },
            prompt: { type: "string", description: "User prompt text." },
            system: { type: "string", description: "Optional system prompt." },
            max_tokens: { type: "integer", description: "Max output tokens (default 1024)." }
          },
          required: ["prompt"]
        }
      },
      {
        name: "factory_add_key",
        description: "Add a Factory account: its login email plus a personal API key (fk-...). The account can serve upstream requests immediately; repeat for every account you own.",
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string", description: "Factory account email (used as the label)." },
            api_key: { type: "string", description: "Factory personal API key (fk-...)." },
            org_id: { type: "string", description: "Optional Factory organization id." }
          },
          required: ["email", "api_key"]
        }
      },
      {
        name: "factory_login",
        description: "Start a Factory device-flow login. Returns a verification URL and code to show the user; after they authorize in the browser, the new account/organization identities are added automatically (check with factory_accounts).",
        inputSchema: { type: "object", properties: {} }
      }
    ];
  }
  mcpResult(id, result) {
    return { jsonrpc: "2.0", id: id ?? null, result };
  }
  mcpError(id, code, message) {
    return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
  }
  mcpText(text, isError = false) {
    return { content: [{ type: "text", text }], ...isError ? { isError: true } : {} };
  }
  async mcpStatus() {
    const meta = this.store.activeIdentity();
    if (!meta) return "No active Factory identity (run vwFactory: Switch Active Identity).";
    const q = liveQuota(this.store.quotas()[meta.id]);
    const lines = [
      `Active identity: ${meta.label}`,
      meta.email ? `Email: ${meta.email}` : void 0,
      meta.orgId ? `Org: ${meta.orgId}` : void 0,
      `Identities configured: ${this.store.identities().length}`
    ].filter((l) => l !== void 0);
    if (q && !q.error) {
      const fmt = (label, b) => b ? `${label} ${Math.round(b.usedPercent)}%` : void 0;
      const parts = [
        fmt("5h", q.standard5h),
        fmt("week", q.standardWeekly),
        fmt("month", q.standardMonthly),
        fmt("core-5h", q.core5h),
        fmt("core-week", q.coreWeekly),
        fmt("core-month", q.coreMonthly)
      ].filter((p) => p !== void 0);
      if (parts.length) lines.push(`Quota used: ${parts.join(" \xB7 ")}`);
      if (q.planType) lines.push(`Plan: ${q.planType}`);
    }
    return lines.join("\n");
  }
  quotaLine(id) {
    const q = liveQuota(this.store.quotas()[id]);
    if (!q || q.error) return "";
    const fmt = (label, b) => b ? `${label} ${Math.round(b.usedPercent)}%` : void 0;
    const parts = [
      fmt("5h", q.standard5h),
      fmt("week", q.standardWeekly),
      fmt("month", q.standardMonthly),
      fmt("core-mo", q.coreMonthly)
    ].filter((p) => p !== void 0);
    return parts.length ? `quota[${parts.join(" ")}]` : "";
  }
  mcpAccounts() {
    const list = this.store.identities();
    if (list.length === 0) return "No Factory identities configured.";
    const activeId = this.store.activeIdentity()?.id;
    return list.map((i) => {
      const bits = [
        i.id === activeId ? "*ACTIVE*" : "        ",
        i.label,
        i.email ? `<${i.email}>` : void 0,
        i.orgId ? `org:${i.orgId}` : void 0,
        i.apiKeyFingerprint ? `key \u2022\u2022${i.apiKeyFingerprint}` : `(${i.kind})`,
        this.quotaLine(i.id)
      ].filter((b) => !!b);
      return bits.join("  ");
    }).join("\n");
  }
  async mcpAddKey(args) {
    const email = typeof args.email === "string" ? args.email.trim() : "";
    const key = typeof args.api_key === "string" ? args.api_key.trim() : "";
    if (!email || !email.includes("@")) return "email is required (the Factory account's login email).";
    if (!key.startsWith("fk-")) return "api_key must be a Factory personal key (fk-...).";
    const meta = {
      id: `apikey-${key.slice(-10)}`,
      kind: "apikey",
      label: email,
      email,
      orgId: typeof args.org_id === "string" ? args.org_id : void 0,
      apiKeyFingerprint: key.slice(-8),
      createdAt: Date.now()
    };
    await this.store.upsertIdentity(meta, { apiKey: key });
    if (!this.store.activeIdentity()) await this.store.setActive(meta.id);
    return `added ${email} (${meta.id})${this.store.activeId() === meta.id ? " \u2014 now active" : ""}`;
  }
  async mcpLogin() {
    if (!this.hooks.login) return "Login is not available in this vwFactory host.";
    try {
      return await this.hooks.login();
    } catch (e) {
      return `login failed: ${errorMessage(e)}`;
    }
  }
  async mcpSwitch(args) {
    const q = String(args.identity ?? "").toLowerCase();
    if (!q) return "missing 'identity'";
    const list = this.store.identities();
    const matches = list.filter(
      (i) => i.id === args.identity || i.label.toLowerCase().includes(q) || (i.email ?? "").toLowerCase().includes(q) || (i.orgId ?? "").toLowerCase().includes(q)
    );
    if (matches.length === 0) {
      return `no identity matches '${args.identity}'. Known:
${this.mcpAccounts()}`;
    }
    if (matches.length > 1) {
      return `ambiguous '${args.identity}' \u2014 matches:
` + matches.map((m) => `  ${m.label} (${m.id})`).join("\n");
    }
    await this.store.setActive(matches[0].id);
    this.emitter.fire(`switched to ${matches[0].label} via MCP`);
    return `switched -> ${matches[0].label} (org ${matches[0].orgId ?? "?"})`;
  }
  async mcpChat(args) {
    const model = typeof args.model === "string" && args.model ? args.model : this.cfg().get("vwFactory.defaultChatModel", "deepseek-v4-pro");
    const maxTokens = typeof args.max_tokens === "number" && args.max_tokens > 0 ? Math.floor(args.max_tokens) : 1024;
    const messages = [];
    if (typeof args.system === "string" && args.system) {
      messages.push({ role: "system", content: args.system });
    }
    messages.push({ role: "user", content: String(args.prompt) });
    const body = {
      model,
      messages,
      max_tokens: maxTokens,
      stream: false
    };
    let identity = await this.routeIdentity(void 0);
    if (!identity) {
      throw new Error("no active Factory identity \u2014 log in via the vwFactory sidebar");
    }
    this.lastRelayAt = Date.now();
    const abort = AbortSignal.timeout(12e4);
    let upstreamRes = await this.proxyOnce("chat", identity, body, {}, abort);
    ({ identity, res: upstreamRes } = await this.failover(
      identity,
      upstreamRes,
      (id) => this.proxyOnce("chat", id, body, {}, abort)
    ));
    const text = await upstreamRes.text();
    if (!upstreamRes.ok) {
      throw new Error(`upstream HTTP ${upstreamRes.status}: ${text.slice(0, 500)}`);
    }
    const data = JSON.parse(text);
    const content = isRecord(data) ? data.choices?.[0]?.message : void 0;
    if (isRecord(content)) {
      const c = content.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        return c.map((p) => isRecord(p) && typeof p.text === "string" ? p.text : "").join("");
      }
    }
    return text.slice(0, 8e3);
  }
  async handleMcp(res, rawBody) {
    let msg;
    try {
      msg = JSON.parse(rawBody || "null");
    } catch {
      this.sendJson(res, 400, this.mcpError(null, -32700, "parse error"));
      return;
    }
    const msgs = Array.isArray(msg) ? msg : [msg];
    const out = [];
    for (const m of msgs) {
      if (!isRecord(m) || typeof m.method !== "string") {
        out.push(this.mcpError(isRecord(m) ? m.id : null, -32600, "invalid request"));
        continue;
      }
      const { id, method } = m;
      const params = isRecord(m.params) ? m.params : {};
      if (id === void 0) continue;
      if (method === "initialize") {
        out.push(
          this.mcpResult(id, {
            protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "vwfactory", version: "0.1.0" },
            instructions: "Factory models via vwFactory. Use factory_models to list models, factory_chat to send a prompt, factory_status for identity/quota."
          })
        );
      } else if (method === "ping") {
        out.push(this.mcpResult(id, {}));
      } else if (method === "tools/list") {
        out.push(this.mcpResult(id, { tools: this.mcpTools() }));
      } else if (method === "tools/call") {
        const name2 = typeof params.name === "string" ? params.name : "";
        const args = isRecord(params.arguments) ? params.arguments : {};
        try {
          if (name2 === "factory_models") {
            await this.kickCatalog();
            const docs = await this.docsCatalog();
            const text = this.availableIds().map((id2) => {
              const e = entryFor(id2, docs);
              return `${id2} \u2014 ${e.name}${e.multiplier !== void 0 ? ` (${e.multiplier}\xD7)` : ""}`;
            }).join("\n");
            out.push(this.mcpResult(id, this.mcpText(text)));
          } else if (name2 === "factory_status") {
            out.push(this.mcpResult(id, this.mcpText(await this.mcpStatus())));
          } else if (name2 === "factory_accounts") {
            out.push(this.mcpResult(id, this.mcpText(this.mcpAccounts())));
          } else if (name2 === "factory_switch") {
            out.push(this.mcpResult(id, this.mcpText(await this.mcpSwitch(args))));
          } else if (name2 === "factory_add_key") {
            out.push(this.mcpResult(id, this.mcpText(await this.mcpAddKey(args))));
          } else if (name2 === "factory_login") {
            out.push(this.mcpResult(id, this.mcpText(await this.mcpLogin())));
          } else if (name2 === "factory_chat") {
            if (typeof args.prompt !== "string" || !args.prompt) {
              out.push(this.mcpResult(id, this.mcpText("missing 'prompt'", true)));
            } else {
              out.push(this.mcpResult(id, this.mcpText(await this.mcpChat(args))));
            }
          } else {
            out.push(this.mcpResult(id, this.mcpText(`unknown tool: ${name2}`, true)));
          }
        } catch (e) {
          out.push(this.mcpResult(id, this.mcpText(errorMessage(e), true)));
        }
      } else {
        out.push(this.mcpError(id, -32601, `method not found: ${method}`));
      }
    }
    if (msgs.every((m) => !isRecord(m) || m.id === void 0)) {
      res.writeHead(202).end();
      return;
    }
    this.sendJson(res, 200, Array.isArray(msg) ? out : out[0]);
  }
  async relay(kind, req, res, rawBody) {
    let body;
    try {
      const parsed = JSON.parse(rawBody || "{}");
      body = isRecord(parsed) ? parsed : {};
    } catch {
      this.sendJson(res, 400, kind === "anthropic" ? anthropicError("invalid JSON body") : openaiError("invalid JSON body"));
      return;
    }
    const convKey = conversationKey(kind, body);
    let identity = await this.routeIdentity(convKey);
    if (!identity) {
      this.sendJson(
        res,
        503,
        kind === "anthropic" ? anthropicError("vwFactory: no active identity; run vwFactory: Switch Active Identity") : openaiError("vwFactory: no active identity")
      );
      return;
    }
    this.lastRelayAt = Date.now();
    this.trackInflight(identity.meta.id, res);
    const abort = new AbortController();
    // res "close" before "finish" = the client went away: cancel upstream too.
    // (req "close" fires as soon as the request body was read on modern Node.)
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });
    const model = normalizeModel(body.model);
    const bridging = kind === "chat" && isClaudeModel(model);
    const upstreamBody = bridging ? openaiChatToAnthropic(body) : body;
    const upstreamKind = bridging ? "anthropic" : kind;
    if (upstreamKind === "anthropic") {
      const wantsThinking = isRecord(upstreamBody.thinking) && upstreamBody.thinking.type === "enabled";
      if (this.modelCache().availability[model]?.adaptive || wantsThinking && prefersAdaptiveThinking(model))
        this.applyAdaptive(upstreamBody);
    }
    const fail = (status, message) => {
      if (res.headersSent || res.destroyed) return;
      this.sendJson(res, status, kind === "anthropic" ? anthropicError(message) : openaiError(message));
    };
    let upstreamRes;
    try {
      upstreamRes = await this.proxyRetrying(upstreamKind, identity, upstreamBody, req.headers, abort.signal);
    } catch (e) {
      fail(e instanceof TimeoutError ? 504 : 502, errorMessage(e));
      return;
    }
    if (upstreamKind === "anthropic" && upstreamRes.status === 400) {
      const errText = await upstreamRes.clone().text().catch(() => "");
      if (/adaptive|output_config/i.test(errText)) {
        const cache = this.modelCache();
        cache.availability[model] = {
          ok: cache.availability[model]?.ok ?? true,
          at: cache.availability[model]?.at ?? Date.now(),
          adaptive: true
        };
        void this.store.saveModelCache?.(cache).catch(() => {
        });
        this.applyAdaptive(upstreamBody);
        try {
          upstreamRes = await this.proxyOnce(
            upstreamKind,
            identity,
            upstreamBody,
            req.headers,
            abort.signal
          );
        } catch {
        }
      }
    }
    try {
      ({ identity, res: upstreamRes } = await this.failover(
        identity,
        upstreamRes,
        (id) => this.proxyRetrying(upstreamKind, id, upstreamBody, req.headers, abort.signal),
        convKey
      ));
    } catch (e) {
      fail(502, errorMessage(e));
      return;
    }
    if (abort.signal.aborted) {
      await upstreamRes.body?.cancel().catch(() => {
      });
      return;
    }
    if (upstreamRes.ok) void this.refreshQuotaFor(identity.meta, 3 * 6e4);
    if (bridging && upstreamRes.status === 200) {
      await this.pipeBridged(upstreamRes, res, model, abort.signal);
      return;
    }
    const ct = upstreamRes.headers.get("content-type") ?? "application/json";
    res.writeHead(upstreamRes.status, {
      "Content-Type": ct,
      "Cache-Control": "no-cache"
    });
    if (!upstreamRes.body) {
      res.end();
      return;
    }
    const isSse = ct.includes("text/event-stream");
    const tap = kind === "chat" && upstreamRes.ok && upstreamProviderFor(model) === "google" ? new GeminiSigTap(isSse) : void 0;
    await this.pipeThrough(Readable.fromWeb(upstreamRes.body), res, isSse ? kind : void 0, abort.signal, tap);
  }
  /**
   * Copy an upstream body to the client. If upstream dies mid-stream, an SSE
   * response gets a protocol-native error event before it ends, so the client
   * shows an error instead of waiting forever on a half-open stream.
   */
  pipeThrough(stream, res, sseKind, signal, tap) {
    return new Promise((resolve) => {
      let tail = "";
      const tapSafe = (fn) => {
        try {
          fn();
        } catch {
        }
      };
      stream.on("data", (chunk) => {
        if (tap) tapSafe(() => tap.data(chunk));
        if (sseKind) tail = (tail + chunk.toString("latin1")).slice(-2);
        if (!res.write(chunk)) {
          stream.pause();
          res.once("drain", () => stream.resume());
        }
      });
      stream.on("end", () => {
        if (tap) tapSafe(() => tap.end());
        res.end();
        resolve();
      });
      stream.on("error", (e) => {
        if (signal?.aborted || res.destroyed) {
          res.destroy();
        } else {
          this.emitter.fire(`upstream stream failed: ${errorMessage(e)}`);
          if (sseKind) {
            if (tail && tail !== "\n\n") res.write("\n\n");
            res.write(sseErrorFrame(sseKind, errorMessage(e)));
          }
          res.end();
        }
        resolve();
      });
      res.once("close", () => {
        if (!res.writableFinished) stream.destroy();
        resolve();
      });
    });
  }
  /** Rewrite enabled-thinking params to the adaptive form new models require. */
  applyAdaptive(body) {
    const effort = this.pickEffort(body);
    body.thinking = { type: "adaptive" };
    body.output_config = {
      ...isRecord(body.output_config) ? body.output_config : {},
      effort
    };
  }
  /** Best-effort reasoning level for adaptive-thinking rewrites. */
  pickEffort(body) {
    const thinking = isRecord(body.thinking) ? body.thinking : {};
    const cfg = isRecord(body.output_config) ? body.output_config : {};
    const levels = /* @__PURE__ */ new Set(["low", "medium", "high", "xhigh", "max"]);
    for (const c of [cfg.effort, body.effort, body.reasoning_effort, thinking.effort])
      if (typeof c === "string" && levels.has(c)) return c;
    const budget = typeof thinking.budget_tokens === "number" ? thinking.budget_tokens : 0;
    return budget >= 16384 ? "high" : budget >= 4096 ? "medium" : budget > 0 ? "low" : "medium";
  }
  /** Pipe an Anthropic response back to an OpenAI-chat client, translated. */
  async pipeBridged(upstreamRes, res, model, signal) {
    const ct = upstreamRes.headers.get("content-type") ?? "";
    if (!upstreamRes.body) {
      res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
      return;
    }
    const stream = Readable.fromWeb(upstreamRes.body);
    if (!ct.includes("text/event-stream")) {
      let text;
      try {
        text = await streamToText(stream);
      } catch (e) {
        if (!signal?.aborted && !res.destroyed) this.sendJson(res, e instanceof TimeoutError ? 504 : 502, openaiError(errorMessage(e)));
        return;
      }
      try {
        const anthropic = JSON.parse(text);
        this.sendJson(res, 200, anthropicToOpenAIChat(anthropic, model));
      } catch {
        this.sendJson(res, 502, openaiError("vwFactory: unparseable upstream response"));
      }
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    const translator = new AnthropicSseToChat(model);
    // setEncoding uses a StringDecoder, so a multi-byte character (CJK, emoji)
    // split across two network chunks is no longer turned into U+FFFD.
    stream.setEncoding("utf8");
    let buf = "";
    let doneSent = false;
    const emit = (out) => {
      if (!out) return;
      if (out.includes("data: [DONE]")) {
        if (doneSent) out = out.replace(/data: \[DONE\]\n\n/g, "");
        doneSent = true;
        if (!out) return;
      }
      res.write(out);
    };
    const flushEvent = (rawEvent) => {
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("data:")) emit(translator.event(line.slice(5).trim()));
      }
    };
    await new Promise((resolve) => {
      stream.on("data", (chunk) => {
        // Normalise CRLF framing; a lone trailing \r waits for its \n.
        buf = (buf + chunk).replace(/\r\n/g, "\n");
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const rawEvent = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          flushEvent(rawEvent);
        }
      });
      stream.on("end", () => {
        if (buf.trim()) flushEvent(buf.replace(/\r$/, ""));
        buf = "";
        if (!doneSent) res.write("data: [DONE]\n\n");
        res.end();
        resolve();
      });
      stream.on("error", (e) => {
        if (signal?.aborted || res.destroyed) res.destroy();
        else {
          this.emitter.fire(`upstream stream failed: ${errorMessage(e)}`);
          res.write(sseErrorFrame("chat", errorMessage(e)));
          res.end();
        }
        resolve();
      });
      res.once("close", () => {
        if (!res.writableFinished) stream.destroy();
        resolve();
      });
    });
  }
  /** Settings-page API for Gumloop accounts: /api/gumloop/<action>. */
  async handleGumloopApi(action, req, res) {
    const gl = this.gumloop;
    const body = req.method === "POST" ? await this.readBody(req) : {};
    const id = typeof body.id === "string" ? body.id : "";
    const syncModels = async () => {
      try {
        return await this.hooks.syncModels?.() ?? false;
      } catch {
        return false;
      }
    };
    try {
      if (action === "state" && req.method === "GET") {
        this.sendJson(res, 200, gl.publicState());
      } else if (action === "add" && req.method === "POST") {
        const first = gl.accounts().length === 0;
        const meta = await gl.add(body);
        const changed = await syncModels();
        this.sendJson(res, 200, { message: `added ${meta.label}`, id: meta.id, modelsChanged: changed, first });
      } else if (action === "remove" && req.method === "POST") {
        await gl.remove(id);
        this.sendJson(res, 200, { message: "removed", modelsChanged: await syncModels() });
      } else if (action === "switch" && req.method === "POST") {
        gl.setActive(id);
        this.sendJson(res, 200, { message: "switched" });
      } else if (action === "calibrate" && req.method === "POST") {
        gl.calibrate(id, body.balance, body.allowance);
        this.sendJson(res, 200, { message: "calibrated", state: gl.publicState() });
      } else if (action === "refresh" && req.method === "POST") {
        await gl.refreshModels(true);
        let priceError;
        await gl.refreshPrices(true).catch((e) => {
          priceError = errorMessage(e);
        });
        this.sendJson(res, 200, { message: "refreshed", models: gl.models().length, priceError, modelsChanged: await syncModels() });
      } else {
        this.sendJson(res, 404, { error: `unknown Gumloop action ${action}` });
      }
    } catch (e) {
      this.sendJson(res, 400, { error: errorMessage(e) });
    }
  }
  async handle(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path5 = url.pathname;
    const rejection = this.requestFence(req);
    if (rejection) {
      this.sendJson(res, 403, openaiError(`vwFactory: ${rejection} rejected`));
      return;
    }
    if (req.method === "GET" && (path5 === "/" || path5 === "/dashboard")) {
      const token = await this.store.proxyToken();
      const html = DASHBOARD_HTML.replace(
        "</head>",
        `<script>localStorage.setItem("fb.token",${JSON.stringify(token)})</script></head>`
      );
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff"
      });
      res.end(html);
      return;
    }
    if (req.method === "GET" && path5 === "/health") {
      const active = this.store.activeIdentity();
      this.sendJson(res, 200, {
        ok: true,
        identity: active?.label ?? null,
        org: active?.orgId ?? null
      });
      return;
    }
    if (!await this.authorized(req)) {
      this.sendJson(res, 401, openaiError("vwFactory: invalid or missing local proxy key"));
      return;
    }
    if (path5 === "/api/state" && req.method === "GET") {
      const activeId = this.store.activeId();
      const quotas = this.store.quotas();
      this.pruneSticky();
      const alerts = this.store.alerts?.() ?? [];
      this.sendJson(res, 200, {
        autoSwitch: await this.autoSwitchOn(),
        routing: this.routingMode(),
        storeWarnings: this.store.recovery ?? [],
        secretsEncrypted: this.store.secretsMode === "dpapi",
        alertSeq: this.store.alertSeq?.() ?? 0,
        alerts: alerts.slice(-10),
        gumloop: this.gumloop.publicState(),
        identities: this.store.identities().map((i) => ({
          sessions: this.sessionsOf(i.id),
          inflight: this.inflight.get(i.id) ?? 0,
          id: i.id,
          kind: i.kind,
          label: i.label,
          email: i.email,
          orgId: i.orgId,
          fingerprint: i.apiKeyFingerprint,
          active: i.id === activeId,
          quota: liveQuota(quotas[i.id]),
          cooldown: this.cooldownOf(i.id)
        }))
      });
      return;
    }
    if (path5.startsWith("/api/gumloop/")) {
      await this.handleGumloopApi(path5.slice("/api/gumloop/".length), req, res);
      return;
    }
    if (path5 === "/api/add" && req.method === "POST") {
      const body = await this.readBody(req);
      this.sendJson(res, 200, { message: await this.mcpAddKey(body) });
      return;
    }
    if (path5 === "/api/switch" && req.method === "POST") {
      const body = await this.readBody(req);
      const id = typeof body.id === "string" ? body.id : "";
      const meta = this.store.identities().find((i) => i.id === id);
      if (!meta) {
        this.sendJson(res, 404, { error: "unknown identity" });
        return;
      }
      await this.store.setActive(meta.id);
      this.sendJson(res, 200, { message: `switched -> ${meta.label}` });
      return;
    }
    if (path5 === "/api/remove" && req.method === "POST") {
      const body = await this.readBody(req);
      const id = typeof body.id === "string" ? body.id : "";
      await this.store.removeIdentity(id);
      this.sendJson(res, 200, { message: "removed" });
      return;
    }
    if (path5.startsWith("/api/update")) {
      if (!this.updater && this.store.statePath) this.updater = new Updater(path3.dirname(this.store.statePath), this.store);
      if (!this.updater) {
        this.sendJson(res, 400, { error: "updates not supported on this host" });
        return;
      }
      try {
        if (path5 === "/api/update" && req.method === "GET") this.sendJson(res, 200, await this.updater.status());
        else if (path5 === "/api/update/check" && req.method === "POST") this.sendJson(res, 200, await this.updater.status(true));
        else if (path5 === "/api/update/install" && req.method === "POST") this.sendJson(res, 200, await this.updater.install());
        else if (path5 === "/api/update/rollback" && req.method === "POST") this.sendJson(res, 200, await this.updater.rollback());
        else this.sendJson(res, 404, { error: "not found" });
      } catch (e) {
        this.sendJson(res, e?.manual ? 409 : 500, { error: errorMessage(e), manual: !!e?.manual });
      }
      return;
    }
    if (path5 === "/api/routing" && req.method === "POST") {
      const body = await this.readBody(req);
      if (!this.store.setRoutingMode) {
        this.sendJson(res, 400, { error: "routing not configurable on this host" });
        return;
      }
      const mode = body.mode === "balance" ? "balance" : "single";
      await this.store.setRoutingMode(mode);
      if (mode === "single") this.sticky.clear();
      this.sendJson(res, 200, { message: `routing ${mode}` });
      return;
    }
    if (path5 === "/api/failover" && req.method === "POST") {
      const body = await this.readBody(req);
      const store = this.store;
      if (!store.setAutoSwitch) {
        this.sendJson(res, 400, { error: "auto-switch not configurable on this host" });
        return;
      }
      await store.setAutoSwitch(body.enabled === true);
      this.sendJson(res, 200, { message: `auto-switch ${body.enabled ? "on" : "off"}` });
      return;
    }
    if (path5 === "/api/refresh" && req.method === "POST") {
      const body = await this.readBody(req).catch(() => ({}));
      const only = typeof body.id === "string" ? body.id : void 0;
      const metas = this.store.identities().filter((m) => !only || m.id === only);
      if (only && metas.length === 0) {
        this.sendJson(res, 404, { error: "unknown identity" });
        return;
      }
      const results = [];
      for (const meta of metas) {
        const cred = await this.store.upstreamCredential(meta);
        if (!cred) {
          results.push(`${meta.label}: skipped (no credential)`);
          continue;
        }
        const q = await fetchQuota(
          cred.apiEndpoint ?? meta.apiEndpoint,
          cred.bearer,
          cred.orgId ?? meta.orgId
        );
        await this.store.saveQuota(meta.id, q);
        results.push(`${meta.label}: ${q.error ? `error ${q.error}` : "updated"}`);
      }
      this.sendJson(res, 200, { message: results.join("\n") || "no accounts" });
      return;
    }
    if (path5 === "/api/export" && req.method === "POST") {
      const body = await this.readBody(req).catch(() => ({}));
      const only = typeof body.id === "string" ? body.id : void 0;
      const lines = [];
      for (const meta of this.store.identities()) {
        if (only && meta.id !== only) continue;
        const secret = await this.store.secret(meta.id);
        const key = secret.apiKey ?? secret.rawKey;
        if (!key) continue;
        lines.push(`${meta.email ?? meta.label}----${key}`);
      }
      if (only && lines.length === 0) {
        this.sendJson(res, 404, { error: "no api key stored for this account" });
        return;
      }
      this.sendJson(res, 200, { text: lines.join("\n"), count: lines.length });
      return;
    }
    if (path5 === "/api/models" && req.method === "GET") {
      await this.kickCatalog();
      const docs = await this.docsCatalog();
      const cache = this.modelCache();
      this.sendJson(res, 200, {
        checkedAt: cache.catalogAt ?? null,
        models: this.availableIds().map((id) => {
          const e = entryFor(id, docs);
          return {
            id,
            name: e.name,
            family: familyOf(id),
            multiplier: e.multiplier ?? null,
            efforts: e.efforts ?? null
          };
        })
      });
      return;
    }
    if (req.method === "GET" && path5 === "/v1/models") {
      await this.kickCatalog();
      this.sendJson(res, 200, {
        object: "list",
        data: this.availableIds().map((id) => ({
          id,
          object: "model",
          created: 0,
          owned_by: "factory",
          multiplier: MULTIPLIERS[id] ?? null
        }))
      });
      return;
    }
    if (req.method !== "POST") {
      this.sendJson(res, 404, openaiError("not found"));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    if (path5 === "/v1/messages") {
      await this.relay("anthropic", req, res, rawBody);
    } else if (path5 === "/v1/messages/count_tokens") {
      this.sendJson(res, 200, { input_tokens: Math.ceil(rawBody.length / 4) });
    } else if (path5 === "/v1/chat/completions") {
      await this.relay("chat", req, res, rawBody);
    } else if (path5 === "/v1/responses") {
      await this.relay("responses", req, res, rawBody);
    } else if (path5 === "/gumloop/v1/chat/completions") {
      await this.gumloop.relay(req, res, rawBody);
    } else if (path5 === "/gumloop/v1/models" && req.method === "GET") {
      this.sendJson(res, 200, { object: "list", data: this.gumloop.models().map((m) => ({ id: m.alias || m.id, object: "model", owned_by: "gumloop" })) });
    } else if (path5 === "/mcp") {
      await this.handleMcp(res, rawBody);
    } else {
      this.sendJson(res, 404, openaiError("not found"));
    }
  }
  dispose() {
    void this.stop();
  }
};

// src/gumloop.ts
// Gumloop accounts: a separate account pool (never mixed into Factory routing)
// served on /gumloop/v1/chat/completions through Gumloop's official
// OpenAI-compatible endpoint. Gumloop exposes no balance API for non-enterprise
// plans, so every call is priced locally from its token usage and subtracted
// from a balance the user calibrates from the Gumloop web page.
var GUMLOOP_WS = process.env.VWFACTORY_GUMLOOP_WS || "https://ws.gumloop.com/api/v1";
var GUMLOOP_API = process.env.VWFACTORY_GUMLOOP_API || "https://api.gumloop.com/api/v1";
var OPENROUTER_API = process.env.VWFACTORY_OPENROUTER_API || "https://openrouter.ai/api/v1";
var GUMLOOP_USD_PER_CREDIT = 5e-3;
var GUMLOOP_DEFAULT_ALLOWANCE = 2e4;
var GUMLOOP_PRICE_TTL_MS = 12 * 36e5;
var GUMLOOP_MODELS_TTL_MS = 6 * 36e5;
var GUMLOOP_RECENT_MAX = 40;
// USD per million tokens [input, output, cacheRead, cacheWrite], used until
// (or when) live prices cannot be fetched. cacheWrite null = billed as input.
var GUMLOOP_FALLBACK_PRICES = {
  "claude-fable-5-1": [10, 50, 0.25, 12.5],
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.1, 2.5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
  "gpt-6-astra": [10, 50, 1, 12.5],
  "gpt-6.1-sol": [2, 10, 0.1, 2.5],
  "gpt-6-sol": [2, 10, 0.2, 2.5],
  "gpt-6-luna": [0.1, 0.5, 0.01, 0.125],
  "grok-4.7": [2, 6, 0.5, null],
  "grok-4.6": [2, 6, 0.5, null],
  "meta/muse-spark-1.3": [1.25, 4.25, 0.15, null],
  "accounts/fireworks/models/glm-5p3": [1.4, 4.4, 0.26, null],
  "z-ai/glm-5.3-flash": [0.15, 0.5, 0.03, null],
  "accounts/fireworks/routers/kimi-k3-us": [3, 15, 0.3, null],
  "accounts/fireworks/models/kimi-k2p7-code": [0.95, 4, 0.19, null],
  "gemini-4-argon": [2, 10, 0.1, 0.1875],
  "gemini-3.1-pro-preview": [2, 12, 0.2, 0.375],
  "gemini-3.8-flash": [0.75, 3.75, 0.075, 0.0417],
  "google/gemma-4-26b-a4b-it": [0.09, 0.3, 0.05, null],
  "accounts/fireworks/models/deepseek-v4p1-flash": [0.3, 1.2, 6e-3, null],
  "accounts/fireworks/models/deepseek-v4-pro-0813": [1.32, 3.96, 0.044, null],
  "accounts/fireworks/models/minimax-m3": [0.3, 1.2, 0.06, null]
};
var GUMLOOP_VENDORS = [
  [/^claude-/, "anthropic", "Anthropic"],
  [/^(gpt-|o\d)/, "openai", "OpenAI"],
  [/^(gemini-|gemma-)/, "google", "Google"],
  [/^grok-/, "x-ai", "xAI"],
  [/^deepseek/, "deepseek", "DeepSeek"],
  [/^glm-/, "z-ai", "Z.AI"],
  [/^kimi-/, "moonshotai", "Moonshot AI"],
  [/^minimax-/, "minimax", "Minimax"],
  [/^qwen/, "qwen", "Alibaba"]
];
/** Gumloop model id -> { orId, fireworks, vendorName } for price lookup. */
function gumloopPriceRef(id) {
  const fireworks = /^accounts\/fireworks\//.test(id);
  let bare = id.replace(/^accounts\/fireworks\/(models|routers)\//, "");
  if (bare.includes("/")) return { orIds: [...new Set([bare, bare.replace(/-\d+(\.\d+)*$/, "")])], fireworks: false };
  bare = bare.replace(/(\d)p(\d)/g, "$1.$2").replace(/-us$/, "");
  const dotted = bare.replace(/(\d)-(\d)/g, "$1.$2");
  const v = GUMLOOP_VENDORS.find(([re]) => re.test(bare));
  const orIds = v ? [`${v[1]}/${dotted}`, `${v[1]}/${bare}`] : [dotted, bare];
  return { orIds: [...new Set(orIds)], fireworks, vendorName: v?.[2] };
}
function perMillion(p) {
  const n = (x) => x === void 0 || x === null || x === "" ? null : Number((Number(x) * 1e6).toPrecision(10));
  const out = [n(p.prompt), n(p.completion), n(p.input_cache_read), n(p.input_cache_write)];
  return out[0] === null || out[1] === null || !Number.isFinite(out[0]) ? void 0 : out;
}
function orPriceEntry(pricing) {
  const base = perMillion(pricing);
  if (!base) return void 0;
  const entry = { p: base };
  const ov = Array.isArray(pricing.overrides) ? pricing.overrides.find((o) => Number(o.min_prompt_tokens) > 0) : void 0;
  const ovp = ov ? perMillion({ ...pricing, ...ov }) : void 0;
  if (ovp) {
    entry.longAt = Number(ov.min_prompt_tokens);
    entry.long = ovp;
  }
  return entry;
}
/** USD cost of one completion from its OpenAI-style usage block. */
function gumloopUsageCost(entry, usage) {
  const prompt = Number(usage?.prompt_tokens) || 0;
  const out = Number(usage?.completion_tokens) || 0;
  const det = isRecord(usage?.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const read = Number(det.cached_tokens) || 0;
  const write = Number(det.cache_write_tokens ?? det.cache_creation_tokens) || 0;
  const fresh = Math.max(0, prompt - read - write);
  const p = entry.long && prompt >= entry.longAt ? entry.long : entry.p;
  const [pin, pout, pread, pwrite] = p;
  const usd = (fresh * pin + read * (pread ?? pin) + write * (pwrite ?? pin) + out * pout) / 1e6;
  return { usd, prompt, out, read, write };
}
function creditsForUsd(usd) {
  return usd > 0 ? Math.ceil(usd / GUMLOOP_USD_PER_CREDIT - 1e-9) : 0;
}
function monthKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
/** Watches a chat-completions response (SSE or JSON) for its usage block. */
var GumloopUsageTap = class {
  constructor(isSse, done) {
    this.isSse = isSse;
    this.done = done;
    this.dec = new StringDecoder("utf8");
    this.buf = "";
    this.usage = void 0;
    this.model = void 0;
  }
  take(obj) {
    if (isRecord(obj?.usage)) this.usage = obj.usage;
    if (typeof obj?.model === "string") this.model = obj.model;
  }
  line(l) {
    const t = l.trim();
    if (!t.startsWith("data:")) return;
    const d = t.slice(5).trim();
    if (!d || d === "[DONE]" || !d.includes('"usage"') && this.model) return;
    try {
      this.take(JSON.parse(d));
    } catch {
    }
  }
  data(chunk) {
    this.buf += this.dec.write(chunk);
    if (!this.isSse) {
      if (this.buf.length > 8e6) this.buf = "";
      return;
    }
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      this.line(this.buf.slice(0, i));
      this.buf = this.buf.slice(i + 1);
    }
  }
  end() {
    this.buf += this.dec.end();
    if (this.isSse) {
      if (this.buf) this.line(this.buf);
    } else {
      try {
        this.take(JSON.parse(this.buf));
      } catch {
      }
    }
    this.buf = "";
    this.done(this.usage);
  }
};
var GumloopRelay = class {
  constructor(proxy) {
    this.proxy = proxy;
    this.store = proxy.store;
    this.cooldowns = /* @__PURE__ */ new Map();
    this.maxOut = /* @__PURE__ */ new Map();
    this.pricesInflight = void 0;
    this.modelsInflight = void 0;
  }
  // ---- persisted state ----
  get st() {
    const s = this.store.state;
    if (!isRecord(s.gumloop)) s.gumloop = {};
    const g = s.gumloop;
    if (!Array.isArray(g.accounts)) g.accounts = [];
    if (!isRecord(g.ledger)) g.ledger = {};
    return g;
  }
  save() {
    this.store.saveState();
  }
  accounts() {
    return this.st.accounts;
  }
  activeAccount() {
    const g = this.st;
    return g.accounts.find((a) => a.id === g.activeId) ?? g.accounts[0];
  }
  ledgerOf(id) {
    const g = this.st;
    const l = isRecord(g.ledger[id]) ? g.ledger[id] : g.ledger[id] = {};
    if (!Array.isArray(l.recent)) l.recent = [];
    if (typeof l.spent !== "number") l.spent = 0;
    if (!isRecord(l.month) || l.month.key !== monthKey()) l.month = { key: monthKey(), credits: 0, calls: 0, usd: 0 };
    return l;
  }
  async credential(id) {
    const s = await this.store.secret(id);
    return s.glKey && s.glUser ? { key: s.glKey, user: s.glUser } : void 0;
  }
  headers(cred) {
    return { Authorization: `Bearer ${cred.key}`, "x-auth-key": cred.user };
  }
  // ---- account management ----
  async add(body) {
    const key = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const user = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!/^[A-Za-z0-9_\-]{16,128}$/.test(key)) throw new Error("API Key format looks wrong");
    if (!/^[A-Za-z0-9_\-]{8,128}$/.test(user)) throw new Error("User ID format looks wrong");
    const cred = { key, user };
    const models = await this.fetchModels(cred);
    const id = `gl-${sha256Hex(user).slice(0, 10)}`;
    const g = this.st;
    const prev = g.accounts.find((a) => a.id === id);
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : prev?.label ?? `Gumloop ${user.slice(0, 4)}\u2026${user.slice(-4)}`;
    const meta = { ...prev ?? {}, id, label, userTail: user.slice(-4), keyTail: key.slice(-4), createdAt: prev?.createdAt ?? Date.now() };
    if (prev) Object.assign(prev, meta);
    else g.accounts.push(meta);
    if (!g.activeId) g.activeId = id;
    await this.store.ready;
    this.store.secrets[id] = { glKey: key, glUser: user };
    this.saveModels(models);
    this.save();
    await this.store.saveSecrets();
    void this.refreshPrices().catch(() => {
    });
    return meta;
  }
  async remove(id) {
    const g = this.st;
    g.accounts = g.accounts.filter((a) => a.id !== id);
    delete g.ledger[id];
    if (g.activeId === id) g.activeId = g.accounts[0]?.id;
    await this.store.ready;
    delete this.store.secrets[id];
    this.save();
    await this.store.saveSecrets();
  }
  setActive(id) {
    const g = this.st;
    if (!g.accounts.some((a) => a.id === id)) throw new Error("unknown Gumloop account");
    g.activeId = id;
    this.save();
  }
  /** Anchor the balance to the number shown on the Gumloop web page. */
  calibrate(id, balance, allowance) {
    const acct = this.st.accounts.find((a) => a.id === id);
    if (!acct) throw new Error("unknown Gumloop account");
    const b = Number(balance);
    if (!Number.isFinite(b) || b < 0 || b > 1e8) throw new Error("balance must be a non-negative number");
    const l = this.ledgerOf(id);
    l.anchor = { balance: Math.round(b), at: Date.now() };
    l.spent = 0;
    delete l.exhaustedAt;
    if (allowance !== void 0 && allowance !== null && allowance !== "") {
      const a = Number(allowance);
      if (!Number.isFinite(a) || a <= 0 || a > 1e8) throw new Error("allowance must be a positive number");
      acct.allowance = Math.round(a);
    }
    this.save();
  }
  // ---- models ----
  async fetchModels(cred) {
    const r = await fetch(`${GUMLOOP_API}/models`, { headers: this.headers(cred), signal: AbortSignal.timeout(3e4) });
    if (r.status === 401 || r.status === 403) throw new Error(`Gumloop rejected the API Key / User ID (HTTP ${r.status})`);
    if (!r.ok) throw new Error(`Gumloop /models failed: HTTP ${r.status}`);
    const j = await r.json();
    const out = [];
    for (const g of Array.isArray(j.model_groups) ? j.model_groups : []) {
      for (const o of Array.isArray(g.options) ? g.options : []) {
        if (!isRecord(o) || typeof o.value !== "string") continue;
        const caps = Array.isArray(o.metadata?.capabilities) ? o.metadata.capabilities : [];
        if (o.status !== "active" || o.restricted || o.is_classifier_model || o.is_image_generation || o.is_voice || o.is_transcription) continue;
        if (!caps.includes("functions") || o.value === "gumloop-chew") continue;
        out.push({
          id: o.value,
          name: typeof o.label === "string" && o.label ? o.label : o.value,
          group: typeof g.groupLabel === "string" ? g.groupLabel : "",
          vision: caps.includes("vision"),
          reasoning: caps.includes("reasoning") || /^claude-(opus|fable)/.test(o.value),
          // Prefer the "short" window: every call bills the whole context, so a
          // 1M window lets one conversation burn thousands of credits per turn.
          context: Number(o.metadata?.short_context_window) || Number(o.metadata?.context_window) || void 0
        });
      }
    }
    if (!out.length) throw new Error("Gumloop returned no usable chat models");
    // DSH addresses models as provider + id: keep ids slash-free ("glm-5p3" for
    // "accounts/fireworks/models/glm-5p3"); the relay maps them back.
    const tails = /* @__PURE__ */ new Map();
    for (const m of out) {
      const tail = m.id.slice(m.id.lastIndexOf("/") + 1);
      tails.set(tail, (tails.get(tail) ?? 0) + 1);
    }
    for (const m of out) {
      const tail = m.id.slice(m.id.lastIndexOf("/") + 1);
      m.alias = tails.get(tail) === 1 ? tail : m.id.replace(/\//g, "--");
    }
    return out;
  }
  /** DSH-side model id (alias or full Gumloop id) -> Gumloop model id. */
  resolveModel(id) {
    if (typeof id !== "string") return "";
    const m = this.models().find((x) => x.alias === id || x.id === id);
    return m ? m.id : id;
  }
  saveModels(list) {
    this.st.models = { at: Date.now(), list };
  }
  models() {
    return Array.isArray(this.st.models?.list) ? this.st.models.list : [];
  }
  async refreshModels(force = false) {
    if (!force && Date.now() - (this.st.models?.at ?? 0) < GUMLOOP_MODELS_TTL_MS && this.models().length) return this.models();
    if (this.modelsInflight) return this.modelsInflight;
    this.modelsInflight = (async () => {
      const acct = this.activeAccount();
      const cred = acct && await this.credential(acct.id);
      if (!cred) return this.models();
      this.saveModels(await this.fetchModels(cred));
      this.save();
      return this.models();
    })().finally(() => {
      this.modelsInflight = void 0;
    });
    return this.modelsInflight;
  }
  /** Entries for the DSH provider block (empty = no Gumloop group). */
  patchEntries() {
    if (!this.accounts().length) return [];
    return this.models();
  }
  // ---- prices ----
  priceEntry(model) {
    const live = this.st.prices?.table?.[model];
    if (live?.p) return { ...live, source: "live" };
    const fb = GUMLOOP_FALLBACK_PRICES[model];
    return fb ? { p: fb, source: "builtin" } : void 0;
  }
  async refreshPrices(force = false) {
    if (!force && Date.now() - (this.st.prices?.at ?? 0) < GUMLOOP_PRICE_TTL_MS) return;
    if (this.pricesInflight) return this.pricesInflight;
    this.pricesInflight = (async () => {
      const ids = this.models().map((m) => m.id);
      if (!ids.length) return;
      const r = await fetch(`${OPENROUTER_API}/models`, { signal: AbortSignal.timeout(3e4) });
      if (!r.ok) throw new Error(`price list HTTP ${r.status}`);
      const data = (await r.json()).data ?? [];
      const byId = new Map(data.map((m) => [m.id, m]));
      const table = {};
      for (const id of ids) {
        const ref = gumloopPriceRef(id);
        const orId = ref.orIds.find((x) => byId.has(x));
        if (!orId) continue;
        let entry;
        if (ref.fireworks) {
          // OpenRouter's headline price is the cheapest host; Gumloop pays Fireworks.
          try {
            const er = await fetch(`${OPENROUTER_API}/models/${orId}/endpoints`, { signal: AbortSignal.timeout(2e4) });
            const eps = er.ok ? (await er.json()).data?.endpoints ?? [] : [];
            const pick = (name) => eps.filter((e) => e.provider_name === name && perMillion(e.pricing ?? {})).sort((a, b) => Number(a.pricing.prompt) - Number(b.pricing.prompt))[0];
            const ep = pick("Fireworks") ?? (ref.vendorName ? pick(ref.vendorName) : void 0);
            if (ep) entry = orPriceEntry(ep.pricing);
          } catch {
          }
        }
        entry ??= orPriceEntry(byId.get(orId).pricing ?? {});
        if (entry) table[id] = { ...entry, ref: orId };
      }
      this.st.prices = { at: Date.now(), table };
      this.save();
    })().finally(() => {
      this.pricesInflight = void 0;
    });
    return this.pricesInflight;
  }
  // ---- accounting ----
  charge(id, model, usage) {
    if (!usage) return;
    const entry = this.priceEntry(model);
    const l = this.ledgerOf(id);
    const rec = { at: Date.now(), model };
    if (entry) {
      const c = gumloopUsageCost(entry, usage);
      rec.usd = Math.round(c.usd * 1e6) / 1e6;
      // "call": every completion is rounded up to a whole credit; "exact": fractional
      // credits accumulate (the balance only ever shows whole numbers).
      rec.credits = this.roundingMode() === "exact" ? Math.round(c.usd / GUMLOOP_USD_PER_CREDIT * 1e4) / 1e4 : creditsForUsd(c.usd);
      Object.assign(rec, { in: c.prompt, out: c.out, cr: c.read, cw: c.write });
      l.spent += rec.credits;
      l.month.credits += rec.credits;
      l.month.usd = Math.round((l.month.usd + c.usd) * 1e6) / 1e6;
    } else {
      rec.unpriced = true;
      rec.in = Number(usage.prompt_tokens) || 0;
      rec.out = Number(usage.completion_tokens) || 0;
      l.unpriced = (l.unpriced ?? 0) + 1;
    }
    l.month.calls += 1;
    l.recent.push(rec);
    if (l.recent.length > GUMLOOP_RECENT_MAX) l.recent.splice(0, l.recent.length - GUMLOOP_RECENT_MAX);
    this.save();
    return rec;
  }
  roundingMode() {
    return this.st.rounding === "exact" ? "exact" : "call";
  }
  remainingOf(id) {
    const l = this.ledgerOf(id);
    if (!l.anchor) return void 0;
    return Math.max(0, Math.floor(l.anchor.balance - l.spent + 1e-9));
  }
  publicState() {
    const g = this.st;
    const active = this.activeAccount();
    return {
      activeId: active?.id ?? null,
      models: this.models().length,
      modelsAt: g.models?.at ?? null,
      pricesAt: g.prices?.at ?? null,
      accounts: g.accounts.map((a) => {
        const l = this.ledgerOf(a.id);
        const cd = this.cooldowns.get(a.id);
        return {
          id: a.id,
          label: a.label,
          userTail: a.userTail,
          keyTail: a.keyTail,
          active: a.id === active?.id,
          allowance: a.allowance ?? GUMLOOP_DEFAULT_ALLOWANCE,
          remaining: this.remainingOf(a.id) ?? null,
          calibratedAt: l.anchor?.at ?? null,
          calibratedBalance: l.anchor?.balance ?? null,
          spentSinceCalibration: l.spent,
          month: l.month,
          unpriced: l.unpriced ?? 0,
          unbilledStops: l.unbilledStops ?? 0,
          exhaustedAt: l.exhaustedAt ?? null,
          cooldown: cd && cd > Date.now() ? cd : null,
          last: l.recent[l.recent.length - 1] ?? null
        };
      })
    };
  }
  // ---- relay ----
  normalizeBody(body) {
    if (body.stream === true) body.stream_options = { ...isRecord(body.stream_options) ? body.stream_options : {}, include_usage: true };
    else delete body.stream_options;
    if (body.max_completion_tokens !== void 0) {
      if (body.max_tokens === void 0) body.max_tokens = body.max_completion_tokens;
      delete body.max_completion_tokens;
    }
    delete body.store;
    if (typeof body.reasoning_effort === "string") {
      if (!isRecord(body.reasoning) && body.reasoning_effort !== "none") body.reasoning = { effort: body.reasoning_effort };
      delete body.reasoning_effort;
    }
    // Claude: Gumloop caches automatically, but with Anthropic's default 5-minute
    // TTL, so a coding session idle for >5 min rewrites its whole context (~150
    // credits for 150k tokens). Ask for the 1-hour TTL instead. Measured 2026-10:
    // Gumloop bills 1h cache writes at the normal (5-minute) write price.
    if (/^claude-/.test(String(body.model)) && body.cache_control === void 0) body.cache_control = { type: "ephemeral", ttl: "1h" };
    return body;
  }
  /** Not cooling down, and not marked out of credits within the last 12h. */
  usable(a, now = Date.now()) {
    if ((this.cooldowns.get(a.id) ?? 0) > now) return false;
    const ex = this.ledgerOf(a.id).exhaustedAt;
    return !ex || now - ex > 12 * 36e5;
  }
  nextAccount(exclude) {
    return this.accounts().find((a) => !exclude.has(a.id) && this.usable(a));
  }
  async attempt(acct, payload, abort, streaming) {
    const cred = await this.credential(acct.id);
    if (!cred) throw new Error(`Gumloop account ${acct.label} has no stored key`);
    for (let i = 0; ; i++) {
      let res;
      let err;
      try {
        res = await this.proxy.upstream(`${GUMLOOP_WS}/chat/completions`, this.headers(cred), payload, {}, abort, streaming);
      } catch (e) {
        if (abort?.aborted) throw e;
        err = e;
      }
      if (res && !TRANSIENT_STATUS.has(res.status)) return res;
      const max = err instanceof TimeoutError ? 1 : TRANSIENT_RETRIES;
      if (i >= max || abort?.aborted) {
        if (res) return res;
        throw err;
      }
      await res?.body?.cancel().catch(() => {
      });
      await sleepAbortable(transientDelay(i, res), abort);
    }
  }
  /** Classify a failed response: "auth" | "credits" | "rate" | undefined. */
  async classify(res) {
    if (res.ok) return void 0;
    const text = await res.clone().text().catch(() => "");
    if (/credit_limit|insufficient.credit|out of credits|credit balance|tier_limit/i.test(text) || res.status === 402) return "credits";
    if (res.status === 401 || res.status === 403) return "auth";
    if (res.status === 429) return "rate";
    return void 0;
  }
  async relay(req, res, rawBody) {
    let body;
    try {
      const parsed = JSON.parse(rawBody || "{}");
      body = isRecord(parsed) ? parsed : {};
    } catch {
      this.proxy.sendJson(res, 400, openaiError("invalid JSON body"));
      return;
    }
    let acct = this.activeAccount();
    if (!acct) {
      this.proxy.sendJson(res, 503, openaiError("vwFactory: no Gumloop account; add one in Settings \u2192 Factory \u2192 Gumloop"));
      return;
    }
    if (!this.usable(acct)) {
      const alt = this.nextAccount(/* @__PURE__ */ new Set([acct.id]));
      if (alt) {
        this.st.activeId = alt.id;
        this.save();
        acct = alt;
      }
    }
    const model = this.resolveModel(body.model);
    if (model) body.model = model;
    this.normalizeBody(body);
    const cap = this.maxOut.get(model);
    if (cap && typeof body.max_tokens === "number" && body.max_tokens > cap) body.max_tokens = cap;
    let payload = JSON.stringify(body);
    const streaming = body.stream === true;
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });
    let upstreamRes;
    const tried = /* @__PURE__ */ new Set();
    for (; ; ) {
      tried.add(acct.id);
      try {
        upstreamRes = await this.attempt(acct, payload, abort.signal, streaming);
        // DSH asks for a generous max_tokens; models with a lower output cap reject
        // it ("max_tokens: 256000 > 128000"). Learn the cap and retry once.
        if (upstreamRes.status === 400 && typeof body.max_tokens === "number") {
          const m = /max_tokens:?\s*(\d+)\s*>\s*(\d+)/.exec(await upstreamRes.clone().text().catch(() => ""));
          const limit = m ? Number(m[2]) : 0;
          if (limit > 0 && limit < body.max_tokens) {
            this.maxOut.set(model, limit);
            body.max_tokens = limit;
            payload = JSON.stringify(body);
            await upstreamRes.body?.cancel().catch(() => {
            });
            upstreamRes = await this.attempt(acct, payload, abort.signal, streaming);
          }
        }
      } catch (e) {
        if (!res.headersSent && !res.destroyed) this.proxy.sendJson(res, e instanceof TimeoutError ? 504 : 502, openaiError(errorMessage(e)));
        return;
      }
      const kind = await this.classify(upstreamRes);
      if (!kind) break;
      if (kind === "credits") {
        const l = this.ledgerOf(acct.id);
        l.exhaustedAt = Date.now();
        if (l.anchor) l.spent = l.anchor.balance;
        this.save();
      } else if (kind === "rate") {
        const ra = parseRetryAfter(upstreamRes.headers.get("retry-after"));
        this.cooldowns.set(acct.id, Date.now() + (ra ?? 6e4));
      }
      const next = this.nextAccount(tried);
      if (!next || abort.signal.aborted) break;
      await upstreamRes.body?.cancel().catch(() => {
      });
      this.proxy.emitter.fire(`Gumloop: ${acct.label} ${kind === "credits" ? "out of credits" : kind === "rate" ? "rate-limited" : "rejected the key"} \u2192 switched to ${next.label}`);
      this.st.activeId = next.id;
      this.save();
      acct = next;
    }
    if (abort.signal.aborted) {
      await upstreamRes.body?.cancel().catch(() => {
      });
      return;
    }
    const ct = upstreamRes.headers.get("content-type") ?? "application/json";
    res.writeHead(upstreamRes.status, { "Content-Type": ct, "Cache-Control": "no-cache" });
    if (!upstreamRes.body) {
      res.end();
      return;
    }
    const isSse = ct.includes("text/event-stream");
    const billed = acct.id;
    const tap = upstreamRes.ok ? new GumloopUsageTap(isSse, (usage) => {
      try {
        this.charge(billed, model, usage);
      } catch {
      }
    }) : void 0;
    await this.proxy.pipeThrough(Readable.fromWeb(upstreamRes.body), res, isSse ? "chat" : void 0, abort.signal, tap);
    if (tap && !tap.usage && abort.signal.aborted) {
      // Client stopped mid-stream: Gumloop still bills the tokens produced so far,
      // but the usage block never arrived. Leave a marker so the user knows to calibrate.
      const l = this.ledgerOf(billed);
      l.unbilledStops = (l.unbilledStops ?? 0) + 1;
      this.save();
    }
  }
  /** Background upkeep: model list and prices. */
  async tick() {
    if (!this.accounts().length) return;
    await this.refreshModels().catch(() => {
    });
    await this.refreshPrices().catch(() => {
    });
  }
};

// src/standalone/dshModels.ts
import * as fs from "node:fs";
// The Factory gateway answers 413 "Request Entity Too Large" to request bodies
// above about 4.5 MB (measured: 4.25 MiB accepted, 4.5 MiB rejected). DSH's
// llm-pi-ai route lets retained images alone reach 20 MiB of base64 by default,
// and token-based compaction never sees image bytes, so an image-heavy session
// hits the 413 and every later request (including /compact) fails the same way.
// Capping the base64 image payload at 3 MiB leaves room for the text history;
// past the cap DSH replaces the oldest images with their attachment id and
// local path. 512 KiB per image keeps four or five recent images in that cap
// instead of two.
var FACTORY_IMAGE_LIMITS = [
  "        maxRequestImageBytes: 3145728",
  "        requestImageMaxBytes: 524288"
];
var PROVIDER_HEADS = {
  "factory-claude": [
    "      factory-claude:",
    "        displayName: Factory (Claude)",
    "        apiKeyEnv: VWFACTORY_TOKEN",
    "        api: anthropic-messages",
    "        baseURL: http://127.0.0.1:4199",
    "        defaultInput: [text, image]",
    ...FACTORY_IMAGE_LIMITS,
    "        models:"
  ],
  "factory-gpt": [
    "      factory-gpt:",
    "        displayName: Factory (GPT)",
    "        apiKeyEnv: VWFACTORY_TOKEN",
    "        api: openai-responses",
    "        baseURL: http://127.0.0.1:4199/v1",
    "        defaultInput: [text, image]",
    ...FACTORY_IMAGE_LIMITS,
    "        models:"
  ],
  // Grok shares the Responses route with GPT but gets its own menu group.
  "factory-grok": [
    "      factory-grok:",
    "        displayName: Factory (Grok)",
    "        apiKeyEnv: VWFACTORY_TOKEN",
    "        api: openai-responses",
    "        baseURL: http://127.0.0.1:4199/v1",
    "        defaultInput: [text, image]",
    ...FACTORY_IMAGE_LIMITS,
    "        models:"
  ],
  // Text-only by default; vision models opt in per model (input: [text, image]).
  factory: [
    "      factory:",
    "        displayName: Factory",
    "        apiKeyEnv: VWFACTORY_TOKEN",
    "        api: openai-completions",
    "        baseURL: http://127.0.0.1:4199/v1",
    ...FACTORY_IMAGE_LIMITS,
    "        models:"
  ]
};
// Open models on the chat-completions route that accept images through the
// Factory gateway (probed with a test image). glm-5.3 / nemotron-3-ultra reject
// images with a 400 and minimax-m2.5 silently drops them, so they stay text-only;
// unknown future models default to text-only too (DSH refuses the image up
// front instead of failing mid-turn). Claude and GPT routes declare images
// provider-wide via defaultInput.
var OPEN_VISION_MODELS = /^(gemini-|kimi-k\d|deepseek-v4|glm-[\d.]+-flash$|minimax-m3\b|minimax-m2\.7\b)/;
var KNOWN_TEXT_ONLY = /* @__PURE__ */ new Set(["glm-5.3", "nemotron-3-ultra", "minimax-m2.5"]);
// Probe results for models outside both lists (state.json visionProbe).
var VISION_PROBED = {};
function supportsImageInput(id) {
  const probed = VISION_PROBED[id];
  if (probed && typeof probed.ok === "boolean") return probed.ok;
  return OPEN_VISION_MODELS.test(id);
}
function needsVisionProbe(id) {
  return !OPEN_VISION_MODELS.test(id) && !KNOWN_TEXT_ONLY.has(id) && !(id in VISION_PROBED);
}
var PROBE_PNG_B64;
/** 32x32 solid red PNG, built once. */
function probePng() {
  if (PROBE_PNG_B64) return PROBE_PNG_B64;
  const W = 32;
  const raw = Buffer.alloc((W * 3 + 1) * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) raw.set([230, 20, 20], y * (W * 3 + 1) + 1 + x * 3);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 4294967295;
    for (const x of b) c = crcTable[(c ^ x) & 255] ^ c >>> 8;
    return (c ^ 4294967295) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(W, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  PROBE_PNG_B64 = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib2.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]).toString("base64");
  return PROBE_PNG_B64;
}
/**
 * Ask a chat-route model for the colour of a red test image through the local
 * proxy. true = it saw the image, false = rejected or blind, undefined =
 * inconclusive (network / 5xx / 429): try again on a later start.
 */
async function probeVisionModel(port, token, model) {
  let r;
  try {
    r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        messages: [{ role: "user", content: [
          { type: "text", text: "What is the dominant color of this image? Answer with one word." },
          { type: "image_url", image_url: { url: `data:image/png;base64,${probePng()}` } }
        ] }]
      }),
      signal: AbortSignal.timeout(6e4)
    });
  } catch {
    return void 0;
  }
  const text = await r.text().catch(() => "");
  if (r.status === 400 || r.status === 422) return /image|vision|modal|multimodal|support/i.test(text) ? false : void 0;
  if (!r.ok) return void 0;
  let answer = "";
  try {
    answer = String(JSON.parse(text).choices?.[0]?.message?.content ?? "");
  } catch {
    return void 0;
  }
  if (!answer.trim()) return void 0;
  return /red|orange|scarlet|crimson|红|橙/i.test(answer);
}
function providerKey(family, id = "") {
  if (family === "anthropic") return "factory-claude";
  if (id.startsWith("grok-")) return "factory-grok";
  if (family === "openai-responses") return "factory-gpt";
  return "factory";
}
var GUMLOOP_PROVIDER_HEAD = [
  "      gumloop:",
  "        displayName: Gumloop",
  "        apiKeyEnv: VWFACTORY_TOKEN",
  "        api: openai-completions",
  "        baseURL: http://127.0.0.1:4199/gumloop/v1",
  "        compat:",
  "          thinkingFormat: openrouter",
  "          maxTokensField: max_tokens",
  "        models:"
];
function yamlQuote(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function gumloopPatchLines(glEntries) {
  if (!glEntries?.length) return [];
  const lines = [...GUMLOOP_PROVIDER_HEAD];
  for (const m of glEntries) {
    lines.push(`          - id: ${yamlQuote(m.alias || m.id)}`, `            name: ${yamlQuote(m.name)}`);
    if (m.vision) lines.push("            input: [text, image]");
    if (m.context) lines.push(`            contextWindow: ${m.context}`);
    if (m.reasoning) lines.push("            reasoningEfforts: { off: null, low: low, medium: medium, high: high }");
  }
  return lines;
}
function syncPatchModels(patchPath, entries, glEntries = []) {
  let src;
  try {
    src = fs.readFileSync(patchPath, "utf8");
  } catch {
    return false;
  }
  const groups = {
    "factory-claude": [],
    "factory-gpt": [],
    "factory-grok": [],
    factory: []
  };
  for (const e of entries) groups[providerKey(e.family, e.id)].push(e);
  const block = ["    providers:"];
  for (const key of Object.keys(PROVIDER_HEADS)) {
    block.push(...PROVIDER_HEADS[key]);
    for (const e of groups[key]) {
      const label = e.multiplier !== void 0 ? `${e.name} \xB7 ${e.multiplier}\xD7` : e.name;
      const safe = label.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      block.push(`          - id: ${e.id}`, `            name: "${safe}"`);
      if (key === "factory" && supportsImageInput(e.id)) block.push("            input: [text, image]");
      if (e.efforts?.length) {
        const pairs = e.efforts.map((l) => `${l}: ${l === "off" ? "null" : l}`);
        block.push(`            reasoningEfforts: { ${pairs.join(", ")} }`);
      }
    }
  }
  block.push(...gumloopPatchLines(glEntries));
  const blockText = block.join("\n");
  const start = src.indexOf("    providers:");
  if (start < 0) return false;
  const rest = src.slice(start);
  const endMatch = /\n- id: /.exec(rest);
  const end = endMatch ? start + endMatch.index : src.length;
  const next = src.slice(0, start) + blockText + "\n" + src.slice(end);
  if (next === src) return false;
  atomicWriteFileSync(patchPath, next);
  return true;
}

// src/factory/auth.ts
var TOKEN_SKEW_MS = 6e4;
async function postForm(url, params) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(3e4)
  });
}
async function readJson(res, label) {
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`${label} failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  try {
    const parsed = JSON.parse(body);
    if (isRecord(parsed)) return parsed;
  } catch {
  }
  throw new Error(`${label} returned an unexpected response`);
}
async function requestDeviceAuthorization() {
  const res = await postForm(WORKOS_DEVICE_AUTHORIZE, { client_id: WORKOS_CLIENT_ID });
  const data = await readJson(res, "device authorization");
  const deviceCode = str(data, "device_code");
  const userCode = str(data, "user_code");
  const verificationUri = str(data, "verification_uri");
  const verificationUriComplete = str(data, "verification_uri_complete");
  const expiresIn = num(data, "expires_in");
  const interval = num(data, "interval");
  if (!deviceCode || !userCode || !verificationUri || !expiresIn || !interval) {
    throw new Error("device authorization response missing fields");
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: verificationUriComplete ?? verificationUri,
    expiresIn,
    interval
  };
}
function parseTokens(data, fallbackRefresh) {
  const accessToken = str(data, "access_token");
  if (!accessToken) throw new Error("token response missing access_token");
  const refreshToken = str(data, "refresh_token") ?? fallbackRefresh;
  if (!refreshToken) throw new Error("token response missing refresh_token");
  const expiresIn = num(data, "expires_in");
  const expiresAt = expiresIn ? Date.now() + expiresIn * 1e3 - TOKEN_SKEW_MS : (expFromJwt(accessToken) ?? Date.now() + 3e5) - TOKEN_SKEW_MS;
  let email;
  const user = data.user;
  if (isRecord(user)) email = str(user, "email");
  email = email ?? emailFromJwt(accessToken);
  return { accessToken, refreshToken, expiresAt, email };
}
var delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollDeviceToken(auth, isCancelled) {
  const deadline = Date.now() + auth.expiresIn * 1e3;
  let interval = auth.interval;
  while (Date.now() < deadline) {
    if (isCancelled()) throw new Error("login cancelled");
    await delay(interval * 1e3);
    const res = await postForm(WORKOS_TOKEN, {
      grant_type: DEVICE_CODE_GRANT,
      device_code: auth.deviceCode,
      client_id: WORKOS_CLIENT_ID
    });
    const body = await res.text();
    if (res.ok) {
      try {
        const parsed = JSON.parse(body);
        if (isRecord(parsed)) return parseTokens(parsed);
      } catch {
      }
      throw new Error("device token returned invalid JSON");
    }
    let code = "unknown";
    try {
      const parsed = JSON.parse(body);
      if (isRecord(parsed)) code = str(parsed, "error") ?? code;
    } catch {
      throw new Error(`device token failed: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    if (code === "authorization_pending") continue;
    if (code === "slow_down") {
      interval += 1;
      continue;
    }
    throw new Error(`device authorization failed: ${code}`);
  }
  throw new Error("device authorization expired");
}
async function refreshTokens(refreshToken, organizationId) {
  const res = await postForm(WORKOS_TOKEN, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: WORKOS_CLIENT_ID,
    ...organizationId ? { organization_id: organizationId } : {}
  });
  const data = await readJson(res, "token refresh");
  return parseTokens(data, refreshToken);
}
async function listOrgIds(accessToken) {
  const res = await fetch(`${FACTORY_API}/api/cli/org`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(3e4)
  });
  if (!res.ok) return [];
  const data = await readJson(res, "org list");
  const ids = data.workosOrgIds;
  return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
}
async function whoami(accessToken, orgId) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };
  if (orgId) headers["X-Factory-Org-Id"] = orgId;
  const res = await fetch(`${FACTORY_API}/api/cli/whoami`, {
    headers,
    signal: AbortSignal.timeout(3e4)
  });
  if (!res.ok) return {};
  const data = await readJson(res, "whoami");
  const region = str(data, "region");
  return {
    orgId: firstStr(data, ["orgId", "org_id", "organization_id", "organizationId"]),
    region,
    apiEndpoint: factoryApiForRegion(region)
  };
}
async function ensureOrgScoped(tokens) {
  if (orgIdFromJwt(tokens.accessToken)) return { tokens };
  const orgs = await listOrgIds(tokens.accessToken);
  const workosOrgId = orgs[0];
  if (!workosOrgId) return { tokens };
  const scoped = await refreshTokens(tokens.refreshToken, workosOrgId);
  return { tokens: scoped, workosOrgId };
}

// src/standalone/login.ts
var running;
async function addOAuthIdentity(store, tokens, workosOrgId) {
  const scopedOrgId = orgIdFromJwt(tokens.accessToken);
  const who = await whoami(tokens.accessToken, scopedOrgId);
  const orgId = who.orgId ?? scopedOrgId;
  const email = tokens.email;
  const id = `oauth-${workosOrgId ?? orgId ?? tokens.refreshToken.slice(0, 12)}`;
  const label = email ? orgId ? `${email} @ ${orgId.slice(-8)}` : email : `Factory ${orgId ?? "account"}`;
  const meta = {
    id,
    kind: "oauth",
    label,
    email,
    orgId,
    apiEndpoint: who.apiEndpoint,
    createdAt: Date.now()
  };
  await store.upsertIdentity(meta, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiresAt: tokens.expiresAt,
    workosOrgId
  });
  return meta;
}
async function tryMintForIdentity(store, meta) {
  const accessToken = await store.oauthBearer(meta);
  if (!accessToken) return;
  try {
    if (meta.email) {
      for (const other of store.identities()) {
        if (other.id === meta.id || other.email !== meta.email) continue;
        const s = await store.secret(other.id);
        if (s.apiKey) {
          await store.upsertIdentity(
            { ...meta, apiKeyId: other.apiKeyId, apiKeyFingerprint: other.apiKeyFingerprint },
            { apiKey: s.apiKey }
          );
          return;
        }
      }
    }
    const key = await createPersonalApiKey(
      accessToken,
      meta.orgId,
      `dsh-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`
    );
    await store.upsertIdentity(
      { ...meta, apiKeyId: key.id, apiKeyFingerprint: key.fingerprint },
      { apiKey: key.value }
    );
  } catch {
  }
}
async function startDeviceLogin(store) {
  if (running && Date.now() - running.startedAt < 15 * 6e4) {
    throw new Error("a login flow is already in progress; finish it or wait for it to expire");
  }
  const auth = await requestDeviceAuthorization();
  running = { startedAt: Date.now() };
  const done = (async () => {
    try {
      const tokens = await pollDeviceToken(auth, () => false);
      const scoped = await ensureOrgScoped(tokens);
      const orgIds = await listOrgIds(tokens.accessToken);
      const metas = [];
      const targetOrgs = orgIds.length > 0 ? orgIds : [scoped.workosOrgId].filter(Boolean);
      for (const org of targetOrgs) {
        const t = org === scoped.workosOrgId || orgIds.length === 0 ? scoped.tokens : await refreshTokens(tokens.refreshToken, org);
        metas.push(await addOAuthIdentity(store, t, org));
      }
      for (const meta of metas) await tryMintForIdentity(store, meta);
      if (!store.activeIdentity() && metas.length > 0) await store.setActive(metas[0].id);
      return `login complete: added ${metas.map((m) => m.label).join(", ")}`;
    } finally {
      running = void 0;
    }
  })().catch((e) => `login failed: ${errorMessage(e)}`);
  return {
    userCode: auth.userCode,
    verificationUri: auth.verificationUri,
    verificationUriComplete: auth.verificationUriComplete,
    expiresIn: auth.expiresIn,
    done
  };
}

// src/standalone/dataHome.ts
import * as fs2 from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
var FILES = ["state.json", "secrets.json"];
function resolveDataHome() {
  if (process.env.VWFACTORY_HOME) return process.env.VWFACTORY_HOME;
  const dir = path.join(os.homedir(), ".vwFactory");
  const legacy = path.join(os.homedir(), ".dsh", "vwFactory");
  try {
    fs2.mkdirSync(dir, { recursive: true, mode: 448 });
    const fresh = FILES.every((f) => !fs2.existsSync(path.join(dir, f)));
    if (fresh && fs2.existsSync(legacy)) {
      for (const f of FILES) {
        const from = path.join(legacy, f);
        if (fs2.existsSync(from)) fs2.copyFileSync(from, path.join(dir, f));
      }
    }
  } catch {
  }
  return dir;
}

// src/standalone/store.ts
import * as fs4 from "node:fs";
import * as path3 from "node:path";
import { execFile } from "node:child_process";
import * as zlib2 from "node:zlib";
import { fileURLToPath } from "node:url";

// src/localToken.ts
import * as fs3 from "node:fs";
import * as os2 from "node:os";
import * as path2 from "node:path";
var DIR = path2.join(os2.homedir(), ".vwFactory");
var FILE = path2.join(DIR, "local-token");
function sharedLocalToken() {
  try {
    const t = fs3.readFileSync(FILE, "utf8").trim();
    if (t.startsWith("fbk-")) return t;
  } catch {
  }
  const token = `fbk-${crypto.randomBytes(24).toString("hex")}`;
  try {
    fs3.mkdirSync(DIR, { recursive: true });
    atomicWriteFileSync(FILE, token, 384);
  } catch {
  }
  return token;
}

// ---- crash-safe file writes ----
// Write to a sibling temp file, fsync, then rename over the target, so a crash
// or power loss leaves either the old or the new file, never a torn one.
// Windows can refuse the rename briefly while another process (antivirus,
// indexer) holds the target open, so retry with a short backoff and fall back
// to a direct write rather than lose the update.
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
  }
}
function atomicWriteFileSync(file, data, mode) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  let fd;
  try {
    fd = fs4.openSync(tmp, "w", mode);
    fs4.writeSync(fd, data);
    try {
      fs4.fsyncSync(fd);
    } catch {
    }
    fs4.closeSync(fd);
    fd = void 0;
    let lastErr;
    for (let i = 0; i < 6; i++) {
      try {
        fs4.renameSync(tmp, file);
        return;
      } catch (e) {
        lastErr = e;
        if (!["EPERM", "EACCES", "EBUSY"].includes(e?.code)) break;
        sleepSync(15 * (i + 1));
      }
    }
    fs4.writeFileSync(file, data, mode === void 0 ? void 0 : { mode });
    void lastErr;
  } finally {
    if (fd !== void 0) try {
      fs4.closeSync(fd);
    } catch {
    }
    try {
      fs4.rmSync(tmp, { force: true });
    } catch {
    }
  }
}
/** Parse a JSON file; undefined when missing, throws "corrupt" on bad content. */
function readJsonStrict(file) {
  let text;
  try {
    text = fs4.readFileSync(file, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return void 0;
    throw e;
  }
  if (!text.trim()) throw new Error("corrupt: empty file");
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new Error(`corrupt: ${errorMessage(e)}`);
  }
}
function cleanupTempFiles(dir) {
  try {
    const cutoff = Date.now() - 6e4;
    for (const name of fs4.readdirSync(dir)) {
      if (!/\.\d+\.[0-9a-f]{8}\.tmp$/.test(name)) continue;
      const p = path3.join(dir, name);
      try {
        if (fs4.statSync(p).mtimeMs < cutoff) fs4.rmSync(p, { force: true });
      } catch {
      }
    }
  } catch {
  }
}

// ---- secrets at rest: Windows DPAPI (CurrentUser scope) ----
// secrets.json holds {"_enc":"dpapi-v1","data":base64}. Node has no DPAPI
// binding, so a hidden Windows PowerShell does the Protect/Unprotect; it only
// runs at startup and when keys change. Other platforms (or
// VWFACTORY_PLAIN_SECRETS=1) keep the 0600 plaintext file.
var SECRETS_ENC = "dpapi-v1";
var DPAPI_ENTROPY_B64 = Buffer.from("vwFactory.secrets.v1").toString("base64");
function dpapiAvailable() {
  return process.platform === "win32" && process.env.VWFACTORY_PLAIN_SECRETS !== "1";
}
// Runs asynchronously: a PowerShell cold start takes 0.5-2 s and must not
// freeze the DSH host event loop (the old execFileSync did, at every startup).
function dpapi(op, inputB64) {
  const fn = op === "protect" ? "Protect" : "Unprotect";
  const script = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;try{Add-Type -AssemblyName System.Security;$i=[Console]::In.ReadToEnd().Trim();$o=[System.Security.Cryptography.ProtectedData]::${fn}([Convert]::FromBase64String($i),[Convert]::FromBase64String('${DPAPI_ENTROPY_B64}'),[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($o))}catch{$x=$_.Exception;while($x.InnerException){$x=$x.InnerException};[Console]::Error.Write('VWFERR '+$x.GetType().Name+': '+$x.Message);exit 3}`;
  const exe = path3.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise((resolve, reject) => {
    const child = execFile(
      exe,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", timeout: 3e4, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (e, stdout, stderr) => {
        if (e) {
          const err = String(stderr ?? "");
          const reason = /VWFERR ([^\r\n]+)/.exec(err)?.[1]?.trim() ?? e?.code ?? (err.split(/\r?\n/).find((l) => l.trim())?.trim() || "PowerShell failed");
          reject(new Error(`DPAPI ${op}: ${reason}`.slice(0, 200)));
          return;
        }
        const out = String(stdout ?? "").replace(/^\uFEFF/, "").trim();
        if (!/^[A-Za-z0-9+/=]+$/.test(out)) reject(new Error("DPAPI returned no data"));
        else resolve(out);
      }
    );
    child.stdin?.on("error", () => {
    });
    child.stdin?.end(inputB64);
  });
}
async function encryptSecrets(obj) {
  const data = await dpapi("protect", Buffer.from(JSON.stringify(obj), "utf8").toString("base64"));
  return { _enc: SECRETS_ENC, data };
}
function isEncryptedSecrets(v) {
  return isRecord(v) && v._enc === SECRETS_ENC && typeof v.data === "string";
}
async function decryptSecrets(env) {
  const json = Buffer.from(await dpapi("unprotect", env.data), "base64").toString("utf8");
  const obj = JSON.parse(json);
  if (!isRecord(obj)) throw new Error("decrypted secrets are not an object");
  return obj;
}

// ---- self-update from GitHub Releases ----
// Downloads the release zip through the GitHub API asset endpoint (served
// from *.githubusercontent.com, which stays reachable where github.com is
// not), verifies size + SHA-256 digest, and replaces the files of this
// plugin directory with the zip's plugin/ folder. The previous files are kept
// under <data>/plugin-backup/v<old> for one-click rollback. A release whose
// package.json sets vwfactory.autoUpdateMinFrom above the running version
// (installer-level changes) must be installed with install.bat instead.
var UPDATE_REPO = "cjj66619/vwfactory-dsh";
var UPDATE_API = (process.env.VWFACTORY_UPDATE_API || "https://api.github.com").replace(/\/+$/, "");
var UPDATE_CACHE_MS = 6 * 36e5;
var UPDATE_MAX_BYTES = 8 * 1024 * 1024;
var GH_HEADERS = { "User-Agent": "vwfactory-updater", Accept: "application/vnd.github+json" };
var PLUGIN_DIR = (() => {
  try {
    return path3.dirname(fileURLToPath(import.meta.url));
  } catch {
    return void 0;
  }
})();
function readPluginPackage(dir = PLUGIN_DIR) {
  try {
    return JSON.parse(fs4.readFileSync(path3.join(dir, "package.json"), "utf8"));
  } catch {
    return {};
  }
}
var RUNNING_VERSION = readPluginPackage().version ?? "0.0.0";
function cmpVer(a, b) {
  const pa = String(a ?? "").replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b ?? "").replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}
async function fetchLatestRelease() {
  const r = await fetch(`${UPDATE_API}/repos/${UPDATE_REPO}/releases/latest`, { headers: GH_HEADERS, signal: AbortSignal.timeout(15e3) });
  if (!r.ok) throw new Error(r.status === 403 ? "GitHub rate limit, try later" : `GitHub HTTP ${r.status}`);
  const j = await r.json();
  const asset = (Array.isArray(j.assets) ? j.assets : []).find((a) => /^vwfactory-dsh-v[\d.]+\.zip$/.test(String(a?.name)));
  return {
    version: String(j.tag_name ?? "").replace(/^v/, ""),
    notes: String(j.body ?? "").slice(0, 4e3),
    page: String(j.html_url ?? `https://github.com/${UPDATE_REPO}/releases/latest`),
    publishedAt: j.published_at,
    asset: asset ? { name: asset.name, size: asset.size, digest: asset.digest, url: asset.url } : void 0
  };
}
/** Minimal zip reader (stored / deflate, no zip64): name -> bytes. */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 101010256) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = /* @__PURE__ */ new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 33639248) throw new Error("bad zip directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen).replace(/\\/g, "/");
    p += 46 + nlen + elen + clen;
    if (name.endsWith("/")) continue;
    if (buf.readUInt32LE(local) !== 67324752) throw new Error("bad zip entry");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib2.inflateRawSync(raw) : void 0;
    if (!data) throw new Error(`unsupported zip method ${method}`);
    if (data.length !== usize) throw new Error(`zip entry ${name} size mismatch`);
    out.set(name, data);
  }
  return out;
}
function listFiles(dir, base = dir) {
  const files = [];
  for (const ent of fs4.readdirSync(dir, { withFileTypes: true })) {
    const p = path3.join(dir, ent.name);
    if (ent.isDirectory()) files.push(...listFiles(p, base));
    else if (ent.isFile()) files.push(path3.relative(base, p));
  }
  return files;
}
var Updater = class {
  constructor(dataDir, store) {
    this.dataDir = dataDir;
    this.store = store;
  }
  cache;
  busy = false;
  diskVersion() {
    return readPluginPackage().version ?? RUNNING_VERSION;
  }
  async status(force = false) {
    if (force || !this.cache || Date.now() - this.cache.at > UPDATE_CACHE_MS) {
      try {
        this.cache = { at: Date.now(), latest: await fetchLatestRelease() };
      } catch (e) {
        this.cache = { at: Date.now(), checkError: errorMessage(e), latest: this.cache?.latest };
        if (force) this.cache.at = 0;
      }
    }
    const disk = this.diskVersion();
    const latest = this.cache.latest;
    const last = this.store.state.update;
    return {
      running: RUNNING_VERSION,
      installed: disk,
      pendingRestart: cmpVer(disk, RUNNING_VERSION) !== 0,
      latest: latest?.version,
      newer: !!latest && cmpVer(latest.version, disk) > 0,
      notes: latest?.notes,
      page: latest?.page ?? `https://github.com/${UPDATE_REPO}/releases/latest`,
      checkedAt: this.cache.at || Date.now(),
      checkError: this.cache.checkError,
      canRollback: !!(last?.backup && fs4.existsSync(last.backup) && cmpVer(last.to, disk) === 0),
      rollbackTo: last?.from,
      supported: !!PLUGIN_DIR
    };
  }
  assertPluginDir() {
    if (!PLUGIN_DIR || readPluginPackage().name !== "dsh-vwfactory") throw new Error("plugin directory not recognized; update with install.bat");
  }
  async install() {
    if (this.busy) throw new Error("an update is already running");
    this.busy = true;
    try {
      this.assertPluginDir();
      const from = this.diskVersion();
      const rel = await fetchLatestRelease();
      if (cmpVer(rel.version, from) <= 0) return { message: `already up to date (v${from})`, upToDate: true };
      if (!rel.asset) throw new Error("the latest release has no package attached");
      if (!/^sha256:[0-9a-f]{64}$/.test(String(rel.asset.digest))) throw new Error("the release package has no SHA-256 digest; download it manually");
      if (rel.asset.size > UPDATE_MAX_BYTES) throw new Error("release package unexpectedly large");
      const r = await fetch(rel.asset.url, { headers: { ...GH_HEADERS, Accept: "application/octet-stream" }, redirect: "follow", signal: AbortSignal.timeout(9e4) });
      if (!r.ok) throw new Error(`download failed: HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length !== rel.asset.size) throw new Error(`download incomplete (${buf.length}/${rel.asset.size} bytes)`);
      const sha = crypto.createHash("sha256").update(buf).digest("hex");
      if (`sha256:${sha}` !== rel.asset.digest) throw new Error("download checksum mismatch; not installed");
      const entries = readZip(buf);
      const prefix = `vwfactory-dsh-v${rel.version}/plugin/`;
      const files = [];
      for (const [name, data] of entries) {
        if (!name.startsWith(prefix)) continue;
        const rel2 = name.slice(prefix.length);
        if (!rel2 || rel2.split("/").some((s) => !s || s === "." || s === "..") || /[:\\]/.test(rel2)) throw new Error(`unsafe path in package: ${name}`);
        files.push([rel2, data]);
      }
      const get = (n) => files.find(([f]) => f === n)?.[1];
      for (const need of ["package.json", "index.js", "client.js"]) if (!get(need)?.length) throw new Error(`package is missing plugin/${need}`);
      const pkg = JSON.parse(get("package.json").toString("utf8"));
      if (pkg.name !== "dsh-vwfactory" || pkg.version !== rel.version) throw new Error("package metadata does not match the release");
      const minFrom = pkg.vwfactory?.autoUpdateMinFrom;
      if (minFrom && cmpVer(from, minFrom) < 0) {
        const err = new Error(`v${rel.version} needs a full reinstall: download it and run install.bat`);
        err.manual = true;
        throw err;
      }
      const backup = path3.join(this.dataDir, "plugin-backup", `v${from}`);
      fs4.rmSync(backup, { recursive: true, force: true });
      for (const f of listFiles(PLUGIN_DIR)) {
        const dst = path3.join(backup, f);
        fs4.mkdirSync(path3.dirname(dst), { recursive: true });
        fs4.copyFileSync(path3.join(PLUGIN_DIR, f), dst);
      }
      // package.json last: until it is written the plugin still reports the old version.
      files.sort(([a], [b]) => (a === "package.json") - (b === "package.json"));
      for (const [f, data] of files) {
        const dst = path3.join(PLUGIN_DIR, ...f.split("/"));
        fs4.mkdirSync(path3.dirname(dst), { recursive: true });
        atomicWriteFileSync(dst, data);
      }
      this.store.state.update = { from, to: rel.version, at: Date.now(), backup };
      this.store.saveState();
      this.cache = void 0;
      return { message: `updated v${from} -> v${rel.version}; restart DSH to apply`, from, to: rel.version };
    } finally {
      this.busy = false;
    }
  }
  async rollback() {
    this.assertPluginDir();
    const last = this.store.state.update;
    if (!last?.backup || !fs4.existsSync(last.backup)) throw new Error("no backup to roll back to");
    const files = listFiles(last.backup);
    if (!files.includes("package.json")) throw new Error("backup is incomplete");
    files.sort((a, b) => (a === "package.json") - (b === "package.json"));
    for (const f of files) atomicWriteFileSync(path3.join(PLUGIN_DIR, f), fs4.readFileSync(path3.join(last.backup, f)));
    this.store.state.update = { ...last, rolledBackAt: Date.now(), backup: void 0 };
    this.store.saveState();
    this.cache = void 0;
    return { message: `rolled back to v${last.from}; restart DSH to apply`, to: last.from };
  }
};

// src/standalone/store.ts
var TOKEN_REFRESH_WINDOW_MS = 9e4;
var STATE_BACKUP_EVERY_MS = 10 * 6e4;
var FileStore = class {
  statePath;
  secretsPath;
  listeners = [];
  state;
  secrets;
  onDidChange = (l) => {
    this.listeners.push(l);
    return { dispose() {
    } };
  };
  /** Problems found while loading (corrupt file recovered from backup, ...). */
  recovery = [];
  lastStateBackup = 0;
  constructor(dir) {
    fs4.mkdirSync(dir, { recursive: true, mode: 448 });
    cleanupTempFiles(dir);
    this.statePath = path3.join(dir, "state.json");
    this.secretsPath = path3.join(dir, "secrets.json");
    this.state = this.readJson(this.statePath, {
      identities: [],
      quotas: {}
    });
    if (!Array.isArray(this.state.identities)) this.state.identities = [];
    if (!isRecord(this.state.quotas)) this.state.quotas = {};
    this.secrets = {};
    const reported = this.recovery.length;
    this.ready = this.loadSecrets().catch((e) => {
      this.recovery.push(`secrets.json could not be loaded (${errorMessage(e).slice(0, 160)})`);
    }).then(() => {
      this.chmod(this.secretsPath);
      for (const msg of this.recovery.slice(reported)) console.warn(`[vwFactory] ${msg}`);
    });
    this.chmod(this.statePath);
    for (const msg of this.recovery) console.warn(`[vwFactory] ${msg}`);
  }
  /** Resolves once secrets.json is decrypted (DPAPI runs off the event loop). */
  ready;
  /** Serializes secrets.json writes so async encryptions never land out of order. */
  secretsWrite = Promise.resolve();
  /** "dpapi" when secrets.json is encrypted at rest, else "plain". */
  secretsMode = "plain";
  secretsLocked = false;
  dpapiBroken = false;
  lastSecretsJson;
  /** Load secrets, decrypting the DPAPI envelope or migrating a plaintext file. */
  async loadSecrets() {
    const raw = this.readJson(this.secretsPath, {});
    if (isEncryptedSecrets(raw)) {
      try {
        const s = await decryptSecrets(raw);
        this.secretsMode = "dpapi";
        this.lastSecretsJson = JSON.stringify(s);
        this.secrets = s;
      } catch (e) {
        this.secretsLocked = true;
        this.recovery.push(
          `secrets.json could not be decrypted (${errorMessage(e).split("\n")[0].slice(0, 160)}); the file was left untouched. It only opens under the Windows account that created it; otherwise re-add the accounts.`
        );
      }
      return;
    }
    const s = isRecord(raw) ? raw : {};
    this.lastSecretsJson = JSON.stringify(s);
    this.secrets = s;
    if (Object.keys(s).length && fs4.existsSync(this.secretsPath) && dpapiAvailable()) {
      await this.writeSecretsFile(s);
      if (this.secretsMode === "dpapi") this.backup(this.secretsPath);
    }
  }
  /** Write secrets.json, encrypted when DPAPI works, plaintext otherwise. */
  async writeSecretsFile(obj) {
    if (dpapiAvailable() && !this.dpapiBroken) {
      try {
        this.writeJson(this.secretsPath, await encryptSecrets(obj));
        this.secretsMode = "dpapi";
        return;
      } catch (e) {
        this.dpapiBroken = true;
        this.recovery.push(`could not encrypt secrets.json (${errorMessage(e).split("\n")[0].slice(0, 160)}); keys are stored as plaintext`);
      }
    }
    this.writeJson(this.secretsPath, obj);
    this.secretsMode = "plain";
  }
  /**
   * Load a JSON file. A missing file yields the fallback; a corrupt one is kept
   * aside as <file>.corrupt-<ts> (so a later save cannot destroy it) and the
   * last good <file>.bak is used instead. A good main file refreshes the backup.
   */
  readJson(file, fallback) {
    const bak = `${file}.bak`;
    try {
      const value = readJsonStrict(file);
      if (value === void 0) {
        const fromBak = this.tryBackup(bak);
        if (fromBak !== void 0) {
          this.recovery.push(`${path3.basename(file)} missing; restored from backup`);
          return fromBak;
        }
        return fallback;
      }
      this.backup(file, bak);
      if (file === this.statePath) this.lastStateBackup = Date.now();
      return value;
    } catch (e) {
      const aside = `${file}.corrupt-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`;
      try {
        fs4.copyFileSync(file, aside);
      } catch {
      }
      const fromBak = this.tryBackup(bak);
      this.recovery.push(
        `${path3.basename(file)} unreadable (${errorMessage(e)}); kept as ${path3.basename(aside)}; ` + (fromBak !== void 0 ? "restored from backup" : "no backup available")
      );
      return fromBak !== void 0 ? fromBak : fallback;
    }
  }
  tryBackup(bak) {
    try {
      return readJsonStrict(bak);
    } catch {
      return void 0;
    }
  }
  /** Copy a known-good file to its .bak (atomically). */
  backup(file, bak = `${file}.bak`) {
    try {
      atomicWriteFileSync(bak, fs4.readFileSync(file), 384);
    } catch {
    }
  }
  writeJson(file, value) {
    atomicWriteFileSync(file, JSON.stringify(value, null, 2), 384);
  }
  chmod(file) {
    try {
      fs4.chmodSync(file, 384);
    } catch {
    }
  }
  notify() {
    for (const l of this.listeners) l();
  }
  saveState() {
    if (Date.now() - this.lastStateBackup > STATE_BACKUP_EVERY_MS && fs4.existsSync(this.statePath)) {
      this.lastStateBackup = Date.now();
      try {
        if (readJsonStrict(this.statePath) !== void 0) this.backup(this.statePath);
      } catch {
      }
    }
    this.writeJson(this.statePath, this.state);
    this.notify();
  }
  saveSecrets() {
    const run = () => this.saveSecretsNow();
    const p = this.secretsWrite.then(run, run);
    this.secretsWrite = p.catch(() => {
    });
    return p;
  }
  async saveSecretsNow() {
    const json = JSON.stringify(this.secrets);
    if (json === this.lastSecretsJson && fs4.existsSync(this.secretsPath)) return;
    if (this.secretsLocked) {
      // Never overwrite a file we could not decrypt: park it for manual recovery.
      try {
        fs4.renameSync(this.secretsPath, `${this.secretsPath}.locked-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`);
      } catch {
      }
      this.secretsLocked = false;
    } else {
      try {
        if (readJsonStrict(this.secretsPath) !== void 0) this.backup(this.secretsPath);
      } catch {
      }
    }
    await this.writeSecretsFile(JSON.parse(json));
    this.lastSecretsJson = json;
    this.chmod(this.secretsPath);
  }
  identities() {
    return this.state.identities;
  }
  activeId() {
    return this.state.activeId;
  }
  activeIdentity() {
    return this.state.identities.find((i) => i.id === this.state.activeId);
  }
  async setActive(id) {
    this.state.activeId = id;
    this.saveState();
  }
  async autoSwitchEnabled() {
    return this.state.autoSwitch !== false;
  }
  async setAutoSwitch(enabled) {
    this.state.autoSwitch = enabled;
    this.saveState();
  }
  /** "single" (one active account) or "balance" (session-sticky spread). */
  routingMode() {
    return this.state.routing === "balance" ? "balance" : "single";
  }
  async setRoutingMode(mode) {
    this.state.routing = mode === "balance" ? "balance" : "single";
    this.saveState();
  }
  // ---- quota / switch alerts (consumed by the DSH client as toasts) ----
  alerts() {
    return Array.isArray(this.state.alerts) ? this.state.alerts : [];
  }
  alertSeq() {
    return this.state.alertSeq ?? 0;
  }
  pushAlert(alert, save = true) {
    const list = Array.isArray(this.state.alerts) ? this.state.alerts : this.state.alerts = [];
    const seq = (this.state.alertSeq ?? 0) + 1;
    this.state.alertSeq = seq;
    list.push({ seq, at: Date.now(), ...alert });
    if (list.length > 30) list.splice(0, list.length - 30);
    if (save) this.saveState();
  }
  /** Fire once per threshold (75/90/100) on the worst standard window; re-arm when usage drops. */
  evalQuotaAlerts(id, quota) {
    if (!hasQuotaData(quota) || quota.staleError) return;
    const q = liveQuota(quota);
    const levels = isRecord(this.state.alertLevels) ? this.state.alertLevels : this.state.alertLevels = {};
    const prev = levels[id] ?? 0;
    let worst = 0;
    let win;
    for (const k of ["standard5h", "standardWeekly", "standardMonthly"]) {
      const p = q[k]?.usedPercent ?? 0;
      if (p >= worst) {
        worst = p;
        win = k;
      }
    }
    const level = worst >= 100 ? 100 : worst >= 90 ? 90 : worst >= 75 ? 75 : 0;
    const meta = this.state.identities.find((i) => i.id === id);
    const label = meta?.label ?? id;
    if (level > prev) {
      this.pushAlert({ kind: "quota", id, label, level, window: win, used: Math.round(worst), resetsAt: q[win]?.resetsAt }, false);
    } else if (prev >= 100 && level < 100) {
      this.pushAlert({ kind: "recover", id, label, used: Math.round(worst) }, false);
    }
    levels[id] = level;
  }
  modelCache() {
    if (!this.state.modelCache) this.state.modelCache = { availability: {} };
    return this.state.modelCache;
  }
  async saveModelCache(cache) {
    this.state.modelCache = cache;
    this.saveState();
  }
  async upsertIdentity(meta, secret) {
    await this.ready;
    const list = this.state.identities;
    const idx = list.findIndex((i) => i.id === meta.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...meta };
    else list.push(meta);
    this.secrets[meta.id] = { ...this.secrets[meta.id] ?? {}, ...secret };
    await this.saveSecrets();
    this.saveState();
  }
  async removeIdentity(id) {
    await this.ready;
    delete this.secrets[id];
    await this.saveSecrets();
    this.state.identities = this.state.identities.filter((i) => i.id !== id);
    delete this.state.quotas[id];
    if (isRecord(this.state.alertLevels)) delete this.state.alertLevels[id];
    if (this.state.activeId === id) this.state.activeId = void 0;
    this.saveState();
  }
  async secret(id) {
    await this.ready;
    return this.secrets[id] ?? {};
  }
  quotas() {
    return this.state.quotas;
  }
  async saveQuota(id, quota) {
    const prev = this.state.quotas[id];
    if (quota?.error && hasQuotaData(prev)) {
      quota = { ...prev, error: void 0, staleError: quota.error, checkedAt: quota.fetchedAt };
    }
    this.state.quotas[id] = quota;
    try {
      this.evalQuotaAlerts(id, quota);
    } catch {
    }
    this.saveState();
  }
  async proxyToken() {
    const token = sharedLocalToken();
    if (this.state.proxyToken !== token) {
      this.state.proxyToken = token;
      this.saveState();
    }
    return token;
  }
  async upstreamCredential(meta) {
    const secret = await this.secret(meta.id);
    const key = secret.apiKey ?? secret.rawKey;
    if (key) return { bearer: key, orgId: meta.orgId, apiEndpoint: meta.apiEndpoint };
    if (meta.kind === "oauth" && secret.refreshToken) {
      let { accessToken, accessTokenExpiresAt, refreshToken, workosOrgId } = secret;
      const expired = !accessToken || !accessTokenExpiresAt || accessTokenExpiresAt - Date.now() < TOKEN_REFRESH_WINDOW_MS;
      try {
        if (expired) {
          const refreshed = await refreshTokens(refreshToken, workosOrgId);
          accessToken = refreshed.accessToken;
          refreshToken = refreshed.refreshToken;
          accessTokenExpiresAt = refreshed.expiresAt;
          await this.upsertIdentity(meta, {
            accessToken,
            refreshToken,
            accessTokenExpiresAt
          });
        }
        return {
          bearer: accessToken,
          orgId: meta.orgId ?? orgIdFromJwt(accessToken),
          apiEndpoint: meta.apiEndpoint
        };
      } catch {
        return void 0;
      }
    }
    return void 0;
  }
  async oauthBearer(meta) {
    if (meta.kind !== "oauth") return void 0;
    const secret = await this.secret(meta.id);
    if (!secret.refreshToken) return void 0;
    let { accessToken, accessTokenExpiresAt, refreshToken, workosOrgId } = secret;
    const expired = !accessToken || !accessTokenExpiresAt || accessTokenExpiresAt - Date.now() < TOKEN_REFRESH_WINDOW_MS;
    if (expired) {
      try {
        const refreshed = await refreshTokens(refreshToken, workosOrgId);
        accessToken = refreshed.accessToken;
        refreshToken = refreshed.refreshToken;
        accessTokenExpiresAt = refreshed.expiresAt;
        await this.upsertIdentity(meta, {
          accessToken,
          refreshToken,
          accessTokenExpiresAt
        });
      } catch {
        return void 0;
      }
    }
    return accessToken;
  }
};

// src/standalone/dsh-plugin.ts
var name = "dsh-vwfactory";
var HOME = resolveDataHome();
var PATCH = path4.join(os3.homedir(), ".dsh", "profiles", "desktop", "cordis.patch.yml");
function portFree(port) {
  return new Promise((resolve) => {
    const req = http2.request(
      { host: "127.0.0.1", port, path: "/v1/models", method: "GET", timeout: 1500 },
      (res) => {
        res.resume();
        resolve(false);
      }
    );
    req.on("error", () => resolve(true));
    req.on("timeout", () => {
      req.destroy();
      resolve(true);
    });
    req.end();
  });
}
// ---- DSH settings-page bridge ----
// The browser half (client.js) calls POST /api/vwfactory.rpc on the DSH web
// server itself. DSH Connection enforces its Host/Origin fence and browser
// session cookie before this handler runs, so the local proxy token never
// reaches the page: the host side relays the call to the 4199 dashboard API.
var UI_RPC_PATH = "/api/vwfactory.rpc";
var UI_RPC_ALLOWED = {
  "GET /api/state": true,
  "GET /api/models": true,
  "POST /api/add": true,
  "POST /api/switch": true,
  "POST /api/remove": true,
  "POST /api/failover": true,
  "POST /api/routing": true,
  "GET /api/update": true,
  "POST /api/update/check": true,
  "POST /api/update/install": true,
  "POST /api/update/rollback": true,
  "POST /api/refresh": true,
  "POST /api/export": true,
  "GET /api/gumloop/state": true,
  "POST /api/gumloop/add": true,
  "POST /api/gumloop/remove": true,
  "POST /api/gumloop/switch": true,
  "POST /api/gumloop/calibrate": true,
  "POST /api/gumloop/refresh": true
};
function uiJson(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
async function handleUiRpc(store, request) {
  let msg;
  try {
    msg = await request.json();
  } catch {
    return uiJson(400, { error: "invalid JSON body" });
  }
  if (!isRecord(msg)) return uiJson(400, { error: "invalid request" });
  const method = msg.method === "GET" ? "GET" : "POST";
  const target = typeof msg.path === "string" ? msg.path : "";
  if (!UI_RPC_ALLOWED[`${method} ${target}`]) return uiJson(404, { error: `unsupported call ${method} ${target}` });
  const token = await store.proxyToken();
  try {
    const res = await fetch(`http://127.0.0.1:4199${target}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(isRecord(msg.body) ? msg.body : {}) : void 0,
      signal: AbortSignal.timeout(12e4)
    });
    const text = await res.text();
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      value = { error: text.slice(0, 300) || `HTTP ${res.status}` };
    }
    return uiJson(res.status, value);
  } catch (e) {
    return uiJson(502, { error: `vwFactory proxy unreachable: ${errorMessage(e)}` });
  }
}
function registerUiBridge(ctx, store) {
  if (typeof ctx.inject !== "function") return;
  try {
    ctx.inject(["connection"], (scope) => {
      scope.connection.fetch.register({
        path: UI_RPC_PATH,
        methods: ["POST"],
        requestBody: "buffered",
        fetch: (request) => handleUiRpc(store, request)
      });
    });
  } catch (e) {
    ctx.logger?.warn?.(`vwFactory: settings bridge unavailable: ${errorMessage(e)}`);
  }
}
function apply(ctx) {
  const store = new FileStore(HOME);
  const cfg = () => ({ get: (_k, d) => d });
  let proxy;
  const syncModels = async () => {
    const entries = await proxy.catalogEntries();
    const changed = syncPatchModels(PATCH, entries, proxy.gumloop.patchEntries());
    if (changed) ctx.logger?.info("vwFactory: model list updated in cordis.patch.yml (restart dsh to apply)");
    return changed;
  };
  proxy = new FactoryProxy(store, cfg, {
    syncModels,
    login: async () => {
      const flow = await startDeviceLogin(store);
      void flow.done;
      return [
        `Open this URL to authorize: ${flow.verificationUriComplete}`,
        `Verification code: ${flow.userCode}`,
        `After authorizing, call factory_accounts to see the new identities.`
      ].join("\n");
    }
  });
  let disposed = false;
  let started = false;
  const boot = async () => {
    while (!disposed && !started) {
      if (!await portFree(4199)) {
        ctx.logger?.info("vwFactory: 4199 served elsewhere; waiting for it to release\u2026");
        await new Promise((r) => setTimeout(r, 8e3));
        continue;
      }
      try {
        await proxy.start();
        started = true;
        ctx.logger?.info(`vwFactory proxy on http://127.0.0.1:${proxy.port}`);
        void proxy.catalogEntries().then(async (entries) => {
          try {
            await proxy.probeVision(entries);
          } catch {
          }
          await proxy.gumloop.tick().catch(() => {
          });
          await syncModels();
        }).catch(() => {
        });
      } catch (e) {
        ctx.logger?.warn(`vwFactory failed to start: ${e}; retrying`);
        await new Promise((r) => setTimeout(r, 8e3));
      }
    }
  };
  void boot();
  registerUiBridge(ctx, store);
  const dispose = () => {
    disposed = true;
    void proxy.stop();
  };
  try {
    ctx.collect?.(dispose);
  } catch {
  }
  ctx.on?.("dispose", dispose);
}
var dsh_plugin_default = { name, apply };
export {
  apply,
  dsh_plugin_default as default,
  name
};
