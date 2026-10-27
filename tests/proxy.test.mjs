// Proxy regression tests: runs plugin/index.js against a mock Factory upstream.
// Usage: node tests/proxy.test.mjs [path/to/index.js]   (Windows also checks DPAPI)
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(process.argv[2] ?? path.join(here, "..", "plugin", "index.js"));
const src = fs.readFileSync(target, "utf8").replace(
  /export \{\s*apply,/,
  "export { FactoryProxy, FileStore, syncPatchModels, apply,"
);
const modPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vwf-test-")), "under-test.mjs");
fs.writeFileSync(modPath, src);

process.env.VWFACTORY_FIRST_BYTE_TIMEOUT_MS = "800";
process.env.VWFACTORY_IDLE_TIMEOUT_MS = "1000";
const { FactoryProxy, FileStore, syncPatchModels } = await import(pathToFileURL(modPath).href + "?" + Date.now());

const results = [];
const ok = (name, cond, info = "") => { results.push({ name, pass: !!cond, info }); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${info ? "  — " + info : ""}`); };

// ---------- mock upstream ----------
let scenario = "ok";
const hits = { kA: 0, kB: 0 };
let lastUpstreamClosed = null;
const sse = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
// chat / responses requests seen by the mock (Gemini / Grok tests)
const seen = [];
const upstream = http.createServer(async (req, res) => {
  const parts = [];
  for await (const c of req) parts.push(c);
  const key = (req.headers.authorization ?? "").replace("Bearer ", "");
  if (req.url.includes("/chat/completions") || req.url.includes("/responses")) {
    const body = JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
    seen.push({ url: req.url, headers: req.headers, body });
    if (req.url.includes("/responses")) { res.writeHead(200, { "Content-Type": "application/json" }).end('{"output":[]}'); return; }
    // Gemini-style tool call carrying a thought signature
    const sig = body.stream ? "SIG-STREAM" : "SIG-JSON";
    const callId = body.stream ? "call_s1" : "call_j1";
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const c1 = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: callId, type: "function", function: { name: "get_time", arguments: "" }, extra_content: { google: { thought_signature: sig } } }] } }] };
      const c2 = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"tz":"Asia/Tokyo"}' } }] }, finish_reason: "tool_calls" }] };
      // split mid-line to exercise buffering
      const text = `data: ${JSON.stringify(c1)}\n\ndata: ${JSON.stringify(c2)}\n\ndata: [DONE]\n\n`;
      const cut = Math.floor(text.length / 3);
      res.write(text.slice(0, cut)); setTimeout(() => res.end(text.slice(cut)), 5);
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: callId, type: "function", function: { name: "get_time", arguments: "{}" }, extra_content: { google: { thought_signature: sig } } }] }, finish_reason: "tool_calls" }] }));
    return;
  }
  if (!req.url.includes("/v1/messages")) { res.writeHead(404).end("{}"); return; }
  hits[key] = (hits[key] ?? 0) + 1;
  const n = hits[key];
  const sseHead = () => res.writeHead(200, { "Content-Type": "text/event-stream" });
  const start = sse({ type: "message_start", message: { id: "msg_1", usage: { input_tokens: 1 } } });
  switch (scenario) {
    case "utf8": {
      sseHead();
      const text = "你好世界🙂";
      const frames = [
        start,
        sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
        sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
        sse({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
      ].join("").replace(/\n/g, "\r\n") + `event: message_stop\r\ndata: {"type":"message_stop"}`; // CRLF + no trailing blank line
      const buf = Buffer.from(frames, "utf8");
      // Write one byte at a time: every multi-byte char gets split.
      for (let i = 0; i < buf.length; i += 1) { res.write(buf.subarray(i, i + 1)); if (i % 40 === 0) await new Promise((r) => setTimeout(r, 1)); }
      res.end();
      return;
    }
    case "die": sseHead(); res.write(start); setTimeout(() => res.socket.destroy(), 50); return;
    case "stall": sseHead(); res.write(start); return; // never ends
    case "nohead": return; // never responds
    case "503x2": if (n <= 2) { res.writeHead(503).end('{"error":"busy"}'); return; } break;
    case "529A": if (key === "kA") { res.writeHead(529).end('{"error":"overloaded"}'); return; } break;
    case "429A": if (key === "kA") { res.writeHead(429).end('{"error":"rate"}'); return; } break;
    case "abort": sseHead(); res.write(start); res.on("close", () => { lastUpstreamClosed = Date.now(); }); return;
  }
  sseHead();
  res.end(start + sse({ type: "message_stop" }));
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const UP = `http://127.0.0.1:${upstream.address().port}`;

// ---------- proxy with real FileStore (plain secrets for speed) ----------
process.env.VWFACTORY_PLAIN_SECRETS = "1";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vwf-store-"));
const store = new FileStore(dir);
await store.ready;
await store.upsertIdentity({ id: "A", kind: "apikey", label: "A", email: "a@x", apiEndpoint: UP }, { apiKey: "kA" });
await store.upsertIdentity({ id: "B", kind: "apikey", label: "B", email: "b@x", apiEndpoint: UP }, { apiKey: "kB" });
await store.setActive("A");
const PORT = 4299;
const proxy = new FactoryProxy(store, () => ({ get: (k, d) => (k === "vwFactory.proxy.port" ? PORT : k === "vwFactory.proxy.requireAuth" ? false : d) }));
const notes = [];
proxy.onDidAutoSwitch((m) => notes.push(m));
await proxy.start();
const P = `http://127.0.0.1:${PORT}`;
const reset = (s) => { scenario = s; hits.kA = 0; hits.kB = 0; notes.length = 0; };
const msgBody = JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 10, stream: true, messages: [{ role: "user", content: "hi" }] });
const post = (p, body, signal) => fetch(P + p, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: signal ?? AbortSignal.timeout(8000) });
const timed = async (fn) => { const t = Date.now(); const v = await fn(); return [v, Date.now() - t]; };

// 1. UTF-8 + CRLF + trailing event (bridged chat)
reset("utf8");
{
  const r = await post("/v1/chat/completions", JSON.stringify({ model: "claude-sonnet-4-6", stream: true, messages: [{ role: "user", content: "hi" }] }));
  const text = await r.text();
  let content = ""; let finish = null;
  for (const l of text.split("\n")) if (l.startsWith("data: {")) { const j = JSON.parse(l.slice(6)); content += j.choices?.[0]?.delta?.content ?? ""; finish = j.choices?.[0]?.finish_reason ?? finish; }
  const dones = (text.match(/\[DONE\]/g) ?? []).length;
  ok("1 bridged UTF-8 split bytes + CRLF", content === "你好世界🙂", JSON.stringify(content));
  ok("1 finish_reason + single [DONE]", finish === "stop" && dones === 1, `finish=${finish} dones=${dones}`);
}
// 2. upstream dies mid-stream
reset("die");
{
  const [text, ms] = await timed(async () => { try { return await (await post("/v1/messages", msgBody)).text(); } catch (e) { return "CLIENT TIMEOUT " + e.name; } });
  ok("2 mid-stream death -> anthropic error event, stream ends", /event: error\ndata: \{"type":"error"/.test(text), `${ms}ms`);
}
// 3. idle stall
reset("stall");
{
  const [text, ms] = await timed(async () => { try { return await (await post("/v1/messages", msgBody)).text(); } catch (e) { return "CLIENT TIMEOUT " + e.name; } });
  ok("3 idle stall -> error event after ~1s", /stalled/.test(text) && ms < 3000, `${ms}ms: ${text.split("\n").find((l) => l.includes("stalled"))?.slice(0, 120)}`);
}
// 4. no response headers
reset("nohead");
{
  const [r, ms] = await timed(() => post("/v1/messages", msgBody));
  const t = await r.text();
  ok("4 first-byte timeout -> 504, retried once", r.status === 504 && hits.kA === 2, `status=${r.status} hitsA=${hits.kA} ${ms}ms ${t.slice(0, 100)}`);
}
// 5. 503 twice then ok, same account
reset("503x2");
{
  const [r, ms] = await timed(() => post("/v1/messages", msgBody));
  await r.text();
  ok("5 503x2 -> retried on same account, 200", r.status === 200 && hits.kA === 3 && hits.kB === 0, `status=${r.status} A=${hits.kA} B=${hits.kB} ${ms}ms`);
}
// 6. 529 forever on A -> borrow B, active stays A
reset("529A");
{
  const r = await post("/v1/messages", msgBody);
  await r.text();
  ok("6 529 on A -> 3 tries then borrowed B, active unchanged", r.status === 200 && hits.kA === 3 && hits.kB === 1 && store.activeId() === "A" && !proxy.cooldownOf("A"), `status=${r.status} A=${hits.kA} B=${hits.kB} active=${store.activeId()} notes=${notes.join(" | ")}`);
}
// 7. 429 on A -> switch to B (regression)
reset("429A");
{
  const r = await post("/v1/messages", msgBody);
  await r.text();
  ok("7 429 on A -> switch active to B, A cooled down", r.status === 200 && hits.kA === 1 && store.activeId() === "B" && !!proxy.cooldownOf("A"), `status=${r.status} A=${hits.kA} active=${store.activeId()}`);
  proxy.cooldowns.clear(); await store.setActive("A");
}
// 8. client abort propagates upstream
reset("abort");
{
  lastUpstreamClosed = null;
  const ac = new AbortController();
  const r = await post("/v1/messages", msgBody, ac.signal);
  const reader = r.body.getReader(); await reader.read();
  const t = Date.now(); ac.abort();
  await new Promise((r) => setTimeout(r, 500));
  ok("8 client abort closes upstream", lastUpstreamClosed !== null, lastUpstreamClosed ? `${lastUpstreamClosed - t}ms` : "upstream still open");
}
// 9. plain non-stream still fine
reset("ok");
{
  const r = await post("/v1/messages", JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 5, messages: [{ role: "user", content: "x" }] }));
  ok("9 normal request 200", r.status === 200 && (await r.text()).includes("message_start"));
}
// 11. Gemini / Grok routing + Gemini thought-signature round trip
reset("ok");
{
  const tools = [{ type: "function", function: { name: "get_time", parameters: { type: "object", properties: {} } } }];
  const user = { role: "user", content: "time?" };
  // DSH replays tool calls WITHOUT extra_content
  const replay = (id) => [user, { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "get_time", arguments: "{}" } }] }, { role: "tool", tool_call_id: id, content: "12:34" }];
  const lastChat = () => seen.filter((s) => s.url.includes("/chat/completions")).at(-1);
  const sigSent = () => lastChat()?.body.messages.find((m) => m.role === "assistant")?.tool_calls?.[0]?.extra_content?.google?.thought_signature;

  seen.length = 0;
  let r = await post("/v1/chat/completions", JSON.stringify({ model: "gemini-3.8-flash", stream: true, tools, messages: [user] }));
  const streamed = await r.text();
  ok("11 gemini -> chat route, x-api-provider google", lastChat()?.headers["x-api-provider"] === "google", lastChat()?.headers["x-api-provider"]);
  ok("11 gemini stream passed through unchanged", streamed.includes("SIG-STREAM") && streamed.includes("[DONE]"));
  await post("/v1/chat/completions", JSON.stringify({ model: "gemini-3.8-flash", tools, messages: replay("call_s1") })).then((x) => x.text());
  ok("11 streamed signature restored on replay", sigSent() === "SIG-STREAM", String(sigSent()));

  r = await post("/v1/chat/completions", JSON.stringify({ model: "gemini-3.8-flash", tools, messages: [user] }));
  await r.text();
  await post("/v1/chat/completions", JSON.stringify({ model: "gemini-3.8-flash", tools, messages: replay("call_j1") })).then((x) => x.text());
  ok("11 non-stream signature restored on replay", sigSent() === "SIG-JSON", String(sigSent()));

  await post("/v1/chat/completions", JSON.stringify({ model: "gemini-3.8-flash", tools, messages: replay("call_unknown") })).then((x) => x.text());
  ok("11 unknown call gets skip fallback", sigSent() === "skip_thought_signature_validator", String(sigSent()));

  await post("/v1/chat/completions", JSON.stringify({ model: "glm-5.3", tools, messages: replay("call_unknown") })).then((x) => x.text());
  ok("11 non-Gemini chat untouched", sigSent() === undefined && lastChat()?.headers["x-api-provider"] === "fireworks", `${sigSent()} ${lastChat()?.headers["x-api-provider"]}`);

  await post("/v1/responses", JSON.stringify({ model: "grok-4.7", input: "hi" })).then((x) => x.text());
  const g = seen.filter((s) => s.url.includes("/responses")).at(-1);
  ok("11 grok -> responses route, xai, no OpenAI-Platform", g?.headers["x-api-provider"] === "xai" && !g?.headers["openai-platform"], `${g?.headers["x-api-provider"]} platform=${g?.headers["openai-platform"]}`);
}
await proxy.stop();
upstream.close();

// 16. DSH model menu: Grok gets its own provider group, not "Factory (GPT)"
{
  const patch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vwf-patch-")), "cordis.patch.yml");
  fs.writeFileSync(patch, "- id: llm-pi-ai\n  config:\n    providers:\n      old: {}\n- id: other\n  config: {}\n");
  syncPatchModels(patch, [
    { id: "gpt-5.5", name: "GPT-5.5", family: "openai-responses", efforts: ["low"] },
    { id: "grok-4.7", name: "Grok 4.7", family: "openai-responses", efforts: ["low", "xhigh"] },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", family: "openai-completions", efforts: ["off", "high"] },
  ]);
  const yml = fs.readFileSync(patch, "utf8");
  // Text of one provider block: from "      <key>:" up to the next provider or top-level item.
  const section = (key) => { const m = new RegExp(`\\n      ${key}:\\n([\\s\\S]*?)(?=\\n      [a-z-]+:\\n|\\n- id: |$)`).exec(yml); return m ? m[1] : ""; };
  const gpt = section("factory-gpt"), grok = section("factory-grok"), open = section("factory");
  ok("16 grok listed under Factory (Grok)", grok.includes("displayName: Factory (Grok)") && grok.includes("- id: grok-4.7") && grok.includes("api: openai-responses"), grok.split("\n").length + " lines");
  ok("16 grok not under Factory (GPT); gpt stays there", !gpt.includes("grok-") && gpt.includes("- id: gpt-5.5"));
  ok("16 gemini under Factory with image input, rest of file kept", open.includes("- id: gemini-3.8-flash") && open.includes("input: [text, image]") && yml.includes("\n- id: other\n"));

  // 17. Image budget stays under the Factory gateway's ~4.5 MB body limit (413 otherwise),
  // both in what the plugin writes on refresh and in the first-install template.
  const limits = (text) => {
    const total = /\n {8}maxRequestImageBytes: (\d+)\r?\n/.exec(text), each = /\n {8}requestImageMaxBytes: (\d+)\r?\n/.exec(text);
    return total && each ? [Number(total[1]), Number(each[1])] : null;
  };
  const underGateway = (l) => !!l && l[0] <= 3 * 1024 * 1024 && l[1] < l[0];
  const keys = ["factory-claude", "factory-gpt", "factory-grok", "factory"];
  const synced = keys.map((k) => [k, limits("\n" + section(k))]);
  ok("17 synced Factory providers cap request images", synced.every(([, l]) => underGateway(l)), JSON.stringify(synced));
  const tpl = fs.readFileSync(path.join(here, "..", "templates", "llm-pi-ai.yml"), "utf8").replace(/\r\n/g, "\n");
  const tplSection = (key) => { const m = new RegExp(`\\n      ${key}:\\n([\\s\\S]*?)(?=\\n      [a-z-]+:\\n|$)`).exec(tpl); return m ? m[1] : ""; };
  const tplLimits = keys.map((k) => [k, limits("\n" + tplSection(k))]);
  ok("17 install template caps request images", tplLimits.every(([, l]) => underGateway(l)), JSON.stringify(tplLimits));
}

// ---------- DPAPI async (Windows only) ----------
if (process.platform === "win32") {
delete process.env.VWFACTORY_PLAIN_SECRETS;
const ddir = fs.mkdtempSync(path.join(os.tmpdir(), "vwf-dpapi-"));
{
  let maxGap = 0, last = Date.now();
  const iv = setInterval(() => { const n = Date.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 10);
  const s1 = new FileStore(ddir);
  await s1.ready;
  await Promise.all([
    s1.upsertIdentity({ id: "X", kind: "apikey", label: "X" }, { apiKey: "fk-secret-1" }),
    s1.upsertIdentity({ id: "Y", kind: "apikey", label: "Y" }, { apiKey: "fk-secret-2" }),
  ]);
  await s1.removeIdentity("Y");
  await s1.upsertIdentity({ id: "Z", kind: "apikey", label: "Z" }, { apiKey: "fk-secret-3" });
  const raw = JSON.parse(fs.readFileSync(path.join(ddir, "secrets.json"), "utf8"));
  ok("10 secrets.json encrypted", raw._enc === "dpapi-v1" && !JSON.stringify(raw).includes("fk-secret"), s1.secretsMode);
  last = Date.now(); maxGap = 0;
  const t = Date.now();
  const s2 = new FileStore(ddir);
  const ctorMs = Date.now() - t;
  const [x, y, z] = [await s2.secret("X"), await s2.secret("Y"), await s2.secret("Z")];
  const totalMs = Date.now() - t;
  clearInterval(iv);
  ok("10 reload decrypts, write order preserved", x.apiKey === "fk-secret-1" && !y.apiKey && z.apiKey === "fk-secret-3", JSON.stringify({ x, y, z }));
  ok("10 constructor does not block on DPAPI", ctorMs < 250 && maxGap < 250, `ctor=${ctorMs}ms decrypt total=${totalMs}ms maxEventLoopGap=${maxGap}ms`);
}
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
