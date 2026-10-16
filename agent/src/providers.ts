// 브리핑·채팅용 JSON만 받는 뇌. Gemini·OpenAI는 공식 HTTP, Codex는 CLI 한 번.
// 도구·MCP·코드 수정 요청은 붙이지 않는다. 키는 로그와 오류 문장에 넣지 않는다.
// 키가 없거나 codex가 없으면 한국어로 실패한다. local로 조용히 넘어가지 않는다.
//
// Codex 는 codex exec 한 번으로 브리핑·채팅 JSON, 그리고 뒤에서 도는 정리(feature-brain.ts: 끝난 할 일 판정·진행 확인·지식그래프·프로필 학습).
// 도구·사용자 MCP 는 붙이지 않는다(CODEX_ARGS). 코드 고치기(fixer.ts)·MCP 읽기는 provider 와 상관없이 Claude Code 경로다.
import type { ContentBlock } from "./attachments.ts";
import { strictSchema, restoreOptionalFields } from "./strict-schema.ts";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { findOnPath, spawnSpec } from "./plat.ts";
import { DEFAULT_GENERAL_MODEL, type BrainProvider, type Config } from "./config.ts";

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Response>;

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  opts?: { input?: string; timeout?: number; cwd?: string },
) => Promise<{ stdout: string; stderr?: string }>;

export type ProviderDeps = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  execFile?: ExecFileLike;
  commandExists?: (name: string) => boolean;
  env?: NodeJS.ProcessEnv;
};

// 출처: https://ai.google.dev/gemini-api/docs/changelog — 새 프로젝트는 3.8 Flash 권장(2.5 는 예전에 쓰던 계정만 열려 새 사용자는 404)
// 기본 모델이 404 면 키로 목록을 받아 가장 새 flash 로 한 번 더 보낸다(geminiJson)
export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
// 출처: https://developers.openai.com/api/docs/models/gpt-4.1-mini — Model ID `gpt-4.1-mini`
export const OPENAI_DEFAULT_MODEL = "gpt-4.1-mini";

export const MISSING_GEMINI_KEY = "Gemini API 키가 없어요. CY_AGENT_GEMINI_API_KEY, GEMINI_API_KEY, 또는 설정의 brain.geminiApiKey를 넣어 주세요.";
export const MISSING_OPENAI_KEY = "OpenAI API 키가 없어요. CY_AGENT_OPENAI_API_KEY, OPENAI_API_KEY, 또는 설정의 brain.openaiApiKey를 넣어 주세요.";
export const MISSING_ANTHROPIC_KEY = "Claude API 키가 없어요. CY_AGENT_ANTHROPIC_API_KEY, 또는 설정의 brain.anthropicApiKey를 넣어 주세요.";
export const MISSING_CODEX = "codex 명령을 찾을 수 없어요. Codex CLI를 설치한 뒤 다시 시도해 주세요.";
export const LOCAL_ONLY = "로컬 뇌는 브리핑·채팅만 답해요.";

// 출처: https://ai.google.dev/api/generate-content — POST /v1beta/{model}:generateContent, 헤더 x-goog-api-key
export const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
// 출처: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/ — Authorization: Bearer
export const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
// Claude API(Messages). 헤더 x-api-key · anthropic-version, JSON 은 output_config.format(json_schema)로 받는다
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

function nonempty(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s || undefined;
}

export function geminiKey(cfg: Pick<Config, "brain">, env: NodeJS.ProcessEnv): string | undefined {
  return nonempty(env.CY_AGENT_GEMINI_API_KEY) ?? nonempty(env.GEMINI_API_KEY) ?? nonempty(cfg.brain?.geminiApiKey);
}

export function openaiKey(cfg: Pick<Config, "brain">, env: NodeJS.ProcessEnv): string | undefined {
  return nonempty(env.CY_AGENT_OPENAI_API_KEY) ?? nonempty(env.OPENAI_API_KEY) ?? nonempty(cfg.brain?.openaiApiKey);
}

export function anthropicKey(cfg: Pick<Config, "brain">, env: NodeJS.ProcessEnv): string | undefined {
  return nonempty(env.CY_AGENT_ANTHROPIC_API_KEY) ?? nonempty(cfg.brain?.anthropicApiKey);
}

// 뇌가 쓸 준비가 됐나(키·명령이 있나). claude-code 는 여기서 모른다(로그인은 SDK 로만 안다) → undefined
export function brainKeyReady(cfg: Pick<Config, "brain">, env: NodeJS.ProcessEnv = process.env): boolean | undefined {
  const p = cfg.brain?.provider ?? "claude-code";
  if (p === "gemini") return !!geminiKey(cfg, env);
  if (p === "openai") return !!openaiKey(cfg, env);
  if (p === "anthropic") return !!anthropicKey(cfg, env);
  if (p === "codex") return commandOnPath("codex", env);
  if (p === "local") return true;
  return undefined;
}

// Claude API 모델: models.general 이 Claude 모델이면 그것, 아니면(Gemini 이름 등) 기본 Claude 모델
export function resolveAnthropicModel(general: string | undefined, override?: string): string {
  const chosen = (override ?? "").trim() || (general ?? "").trim();
  return chosen.startsWith("claude-") ? chosen : DEFAULT_GENERAL_MODEL;
}

// models.general을 쓰되, Claude 기본 이름이면 그 API의 짧고 싼 모델로 바꾼다
export function resolveHttpModel(provider: "gemini" | "openai", general: string | undefined, override?: string): string {
  const chosen = (override ?? "").trim() || (general ?? "").trim();
  if (chosen && chosen !== DEFAULT_GENERAL_MODEL && !chosen.startsWith("claude-")) return chosen;
  return provider === "gemini" ? GEMINI_DEFAULT_MODEL : OPENAI_DEFAULT_MODEL;
}

function tryParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}

export function parseModelJson(text: string, fail: string): unknown {
  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = tryParse(trimmed.slice(start, end + 1));
    if (sliced !== undefined) return sliced;
  }
  throw new Error(fail);
}

// ---- 잘못된 키(401·403) 기억 ----
// 키 지문(해시 앞부분)만 남긴다. 키가 바뀌면 지문이 달라져 저절로 풀린다. 성공하면 바로 지운다
type KeyProvider = "gemini" | "openai" | "anthropic";
const KEY_LABEL: Record<KeyProvider, string> = { gemini: "Gemini", openai: "OpenAI", anthropic: "Claude" };
const badKeys = new Map<KeyProvider, string>();
let onAuthChange: (() => void) | undefined;
const fingerprint = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 16);
export class BrainAuthError extends Error {}
export const authFailText = (p: KeyProvider) => `${KEY_LABEL[p]} API 키가 맞지 않아요. 키를 확인해 주세요`;
// 상태가 바뀌면(키가 틀림 ↔ 다시 됨) 부른다(main 이 SSE status 로 알린다)
export function onBrainAuthChange(fn: (() => void) | undefined) { onAuthChange = fn; }
function markAuth(p: KeyProvider, key: string, bad: boolean) {
  const fp = fingerprint(key);
  const was = badKeys.get(p) === fp;
  if (bad) badKeys.set(p, fp);
  else if (was) badKeys.delete(p);
  if (was !== bad) try { onAuthChange?.(); } catch { /* 알림 실패는 무시 */ }
}
// 지금 쓰는 키가 인증 오류를 받은 그 키인가(뇌가 키 방식이 아니면 false)
export function brainAuthFailed(cfg: Pick<Config, "brain">, env: NodeJS.ProcessEnv = process.env): boolean {
  const p = cfg.brain?.provider;
  if (p !== "gemini" && p !== "openai" && p !== "anthropic") return false;
  const key = p === "gemini" ? geminiKey(cfg, env) : p === "openai" ? openaiKey(cfg, env) : anthropicKey(cfg, env);
  return !!key && badKeys.get(p) === fingerprint(key);
}
export function resetBrainAuth() { badKeys.clear(); }

async function readError(res: Response, fail: string, auth?: { provider: KeyProvider; key: string }): Promise<never> {
  await res.text().catch(() => "");
  if (auth && (res.status === 401 || res.status === 403)) {
    markAuth(auth.provider, auth.key, true);
    throw new BrainAuthError(`${authFailText(auth.provider)} (HTTP ${res.status}).`);
  }
  throw new Error(`${fail} (HTTP ${res.status}).`);
}

const geminiPicked = new Map<string, string>(); // 키 → 기본 대신 쓰는 모델(이 실행 동안만)
const geminiLites = new Map<string, string | undefined>(); // 키 → 붐빌 때 넘어갈 flash-lite(이 실행 동안만)

async function geminiLite(key: string, fetchImpl: FetchLike): Promise<string | undefined> {
  if (!geminiLites.has(key)) geminiLites.set(key, await newestGeminiFlash(key, fetchImpl, true));
  return geminiLites.get(key);
}

// 'gemini-3.8-flash' 같은 일반 flash 중 가장 새 것. lite·preview·image·tts 등은 뺀다.
// lite: true 면 'gemini-3.5-flash-lite' 같은 flash-lite 중 가장 새 것
export function bestGeminiFlash(ids: string[], lite = false): string | undefined {
  const re = lite ? /^gemini-(\d+(?:\.\d+)*)-flash-lite$/ : /^gemini-(\d+(?:\.\d+)*)-flash$/;
  const ver = (id: string) => (re.exec(id)?.[1] ?? "").split(".").filter(Boolean).map(Number);
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (b[i] ?? 0) - (a[i] ?? 0);
      if (d) return d;
    }
    return 0;
  };
  return ids.filter((id) => (ver(id)[0] ?? 0) > 0).sort((a, b) => cmp(ver(a), ver(b)))[0];
}

// 출처: https://ai.google.dev/api/models#method:-models.list — GET /v1beta/models, generateContent 되는 것만
async function newestGeminiFlash(key: string, fetchImpl: FetchLike, lite = false): Promise<string | undefined> {
  try {
    const res = await fetchImpl(`${GEMINI_URL}?pageSize=1000`, { method: "GET", headers: { "x-goog-api-key": key } });
    if (!res.ok) return undefined;
    const data = asRecord(tryParse(await res.text()));
    const models = Array.isArray(data?.models) ? data.models as { name?: string; supportedGenerationMethods?: string[] }[] : [];
    const ids = models
      .filter((m) => m?.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => String(m?.name ?? "").replace(/^models\//, ""));
    return bestGeminiFlash(ids, lite);
  } catch {
    return undefined;
  }
}

// Gemini 가 붐비면(503·500) 또는 너무 자주 보내면(429) 이만큼 쉬고 다시 보낸다
// 출처: 2026-10 무료 키로 시험 — 3.5~3.8 flash 는 503(high demand)이 계속, flash-lite 는 바로 답했다
export const GEMINI_RETRY_MS = [2_000, 5_000];
const BUSY = new Set([429, 500, 503]);

function geminiFailText(status: number): string {
  if (status === 503 || status === 500) return "Gemini가 지금 붐벼서 답하지 못했어요. 잠시 뒤 다시 보내 주세요";
  if (status === 429) return "Gemini 사용량 한도에 걸렸어요(무료 키는 1분·하루 횟수가 정해져 있어요). 잠시 뒤 다시 보내 주세요";
  return "Gemini 요청이 실패했어요";
}

export async function geminiJson(
  cfg: Pick<Config, "brain" | "models">, prompt: string, schema: unknown,
  opts: { system?: string; model?: string; blocks?: ContentBlock[]; fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; env?: NodeJS.ProcessEnv } = {},
): Promise<unknown> {
  const env = opts.env ?? process.env;
  const key = geminiKey(cfg, env);
  if (!key) throw new Error(MISSING_GEMINI_KEY);
  const chosen = resolveHttpModel("gemini", cfg.models?.general, opts.model);
  const picked = chosen === GEMINI_DEFAULT_MODEL ? geminiPicked.get(key) : undefined;
  const fetchImpl = opts.fetch ?? fetch;
  const body = JSON.stringify({
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
    contents: [{ role: "user", parts: [{ text: `${prompt}\n\nJSON만 답하라. 도구 호출이나 코드 수정은 하지 마라.` }, ...(opts.blocks ?? []).map((b) => b.type === "text" ? { text: b.text } : { inlineData: { mimeType: b.source.media_type, data: b.source.data } })] }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema },
  });
  // 키는 헤더에만. URL 쿼리에 넣지 않는다(로그·에러에 남기 쉬움).
  const send = async (model: string) => {
    try {
      return await fetchImpl(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body,
      });
    } catch {
      throw new Error("Gemini 요청을 보내지 못했어요.");
    }
  };
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // 붐비면 쉬었다 다시. Retry-After(초)를 주면 그만큼(최대 30초)
  const retryBusy = async (r: Response, model: string) => {
    for (const wait of GEMINI_RETRY_MS) {
      if (!BUSY.has(r.status)) break;
      const after = Number(r.headers.get("retry-after"));
      await r.text().catch(() => "");
      await sleep(after > 0 ? Math.min(after * 1000, 30_000) : wait);
      r = await send(model);
    }
    return r;
  };
  const first = picked ?? chosen;
  let res = await send(first);
  // 붐비면 가벼운 flash-lite 로 넘어간다(같은 키에서 flash 는 막혀도 lite 는 바로 답하는 일이 많다). lite 가 없으면 같은 모델로 기다렸다 다시
  if (BUSY.has(res.status)) {
    const lite = /-lite$/.test(first) ? undefined : await geminiLite(key, fetchImpl);
    if (lite) {
      await res.text().catch(() => "");
      res = await retryBusy(await send(lite), lite);
    } else {
      res = await retryBusy(res, first);
    }
  }
  // 기본 모델이 이 계정에 없으면(404) 목록에서 가장 새 flash 를 골라 한 번 더
  if (res.status === 404 && chosen === GEMINI_DEFAULT_MODEL && !picked) {
    const best = await newestGeminiFlash(key, fetchImpl);
    if (best && best !== chosen) {
      await res.text().catch(() => "");
      res = await retryBusy(await send(best), best);
      if (res.ok) geminiPicked.set(key, best);
    }
  }
  if (!res.ok) return readError(res, geminiFailText(res.status), { provider: "gemini", key });
  markAuth("gemini", key, false);
  const raw = await res.text();
  const data = asRecord(parseModelJson(raw, "Gemini 응답에서 JSON을 읽지 못했어요."));
  const parts = (data?.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined)?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p) => p?.text ?? "").join("") : "";
  return parseModelJson(text, "Gemini 응답에서 JSON을 읽지 못했어요.");
}

export async function openaiJson(
  cfg: Pick<Config, "brain" | "models">, prompt: string, schema: unknown,
  opts: { system?: string; model?: string; blocks?: ContentBlock[]; fetch?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<unknown> {
  const env = opts.env ?? process.env;
  const key = openaiKey(cfg, env);
  if (!key) throw new Error(MISSING_OPENAI_KEY);
  const model = resolveHttpModel("openai", cfg.models?.general, opts.model);
  const fetchImpl = opts.fetch ?? fetch;
  const messages = [
    ...(opts.system ? [{ role: "system", content: opts.system }] : []),
    { role: "user", content: opts.blocks?.length ? [{ type: "text", text: `${prompt}\n\nJSON만 답하라. 도구 호출이나 코드 수정은 하지 마라.` }, ...opts.blocks.map((b) => b.type === "text" ? b : b.type === "image" ? { type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } } : { type: "file", file: { filename: b.title ?? "attachment.pdf", file_data: `data:application/pdf;base64,${b.source.data}` } })] : `${prompt}\n\nJSON만 답하라. 도구 호출이나 코드 수정은 하지 마라.` },
  ];
  let res: Response;
  try {
    res = await fetchImpl(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: "json_schema", json_schema: { name: "cy_brain", strict: true, schema: strictSchema(schema) } },
      }),
    });
  } catch {
    throw new Error("OpenAI 요청을 보내지 못했어요.");
  }
  if (!res.ok) return readError(res, "OpenAI 요청이 실패했어요", { provider: "openai", key });
  markAuth("openai", key, false);
  const data = asRecord(parseModelJson(await res.text(), "OpenAI 응답에서 JSON을 읽지 못했어요."));
  const content = (data?.choices as { message?: { content?: unknown } }[] | undefined)?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content) ? content.map((p) => (asRecord(p)?.text as string) ?? "").join("") : "";
  return restoreOptionalFields(parseModelJson(text, "OpenAI 응답에서 JSON을 읽지 못했어요."), schema);
}

export async function anthropicJson(
  cfg: Pick<Config, "brain" | "models">, prompt: string, schema: unknown,
  opts: { system?: string; model?: string; blocks?: ContentBlock[]; fetch?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<unknown> {
  const env = opts.env ?? process.env;
  const key = anthropicKey(cfg, env);
  if (!key) throw new Error(MISSING_ANTHROPIC_KEY);
  const model = resolveAnthropicModel(cfg.models?.general, opts.model);
  const fetchImpl = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: "user", content: opts.blocks?.length ? [{ type: "text", text: `${prompt}\n\nJSON만 답하라. 도구 호출이나 코드 수정은 하지 마라.` }, ...opts.blocks] : `${prompt}\n\nJSON만 답하라. 도구 호출이나 코드 수정은 하지 마라.` }],
        output_config: { format: { type: "json_schema", schema } },
      }),
    });
  } catch {
    throw new Error("Claude API 요청을 보내지 못했어요.");
  }
  if (!res.ok) return readError(res, "Claude API 요청이 실패했어요", { provider: "anthropic", key });
  markAuth("anthropic", key, false);
  const data = asRecord(parseModelJson(await res.text(), "Claude API 응답에서 JSON을 읽지 못했어요."));
  if (data?.stop_reason === "refusal") throw new Error("Claude 가 이 요청에는 답하지 않았어요.");
  const content = Array.isArray(data?.content) ? data!.content as unknown[] : [];
  const text = content.map((b) => { const r = asRecord(b); return r?.type === "text" && typeof r.text === "string" ? r.text : ""; }).join("");
  return parseModelJson(text, "Claude API 응답에서 JSON을 읽지 못했어요.");
}

// PATH만 본다. codex 바이너리는 실행하지 않는다.
export function commandOnPath(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!/^[A-Za-z0-9._+-]+$/.test(name)) return false;
  if (process.platform === "win32") return !!findOnPath(name, env); // PATHEXT(.cmd 등)·Path 키
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch { /* 다음 디렉터리 */ }
  }
  return false;
}

function agentText(ev: Record<string, unknown>): string | undefined {
  const item = asRecord(ev.item);
  if (item && (item.type === "agent_message" || item.type === "message") && typeof item.text === "string") return item.text;
  if ((ev.type === "agent_message" || ev.type === "message") && typeof ev.text === "string") return ev.text;
  return undefined;
}

// 출처: https://developers.openai.com/codex/noninteractive — `codex exec --json`, 프롬프트 `-` 는 stdin.
// 플래그 세부는 CLI 버전에 따라 다를 수 있다. 테스트는 명령·인자 형태만 본다.
export function parseCodexStdout(stdout: string): unknown {
  const trimmed = stdout.trim();
  const whole = asRecord(tryParse(trimmed));
  if (whole && ("bubble" in whole || "reply_md" in whole || "reply" in whole)) return whole;
  let lastText: string | undefined;
  let lastObj: Record<string, unknown> | undefined;
  for (const line of trimmed.split("\n")) {
    const rec = asRecord(tryParse(line.trim()));
    if (!rec) continue;
    const text = agentText(rec);
    if (text) lastText = text;
    else if ("bubble" in rec || "reply_md" in rec || "reply" in rec) lastObj = rec;
  }
  if (lastText) return parseModelJson(lastText, "codex 출력에서 JSON을 읽지 못했어요.");
  if (lastObj) return lastObj;
  if (whole) return whole;
  return parseModelJson(trimmed, "codex 출력에서 JSON을 읽지 못했어요.");
}

// Windows: cmd.exe 를 죽여도 그 아래 codex 는 남는다 → taskkill /T 로 나무째
export function killTree(pid: number | undefined) {
  if (process.platform !== "win32" || !pid) return;
  try { spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => {}); } catch {}
}

export function defaultExecFile(file: string, args: readonly string[], opts: { input?: string; timeout?: number; cwd?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Windows: npm 이 깐 codex 는 codex.cmd → cmd.exe /d /s /c 로(인자는 고정 플래그뿐, 프롬프트는 stdin)
    const sp = spawnSpec(file, args);
    const child = spawn(sp.file, sp.args, { cwd: opts.cwd, windowsHide: true, windowsVerbatimArguments: sp.verbatim, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => { killTree(child.pid); child.kill(); reject(new Error("codex 실행 시간이 초과됐어요.")); }, opts.timeout ?? 120_000);
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", () => { clearTimeout(timer); reject(new Error("codex 실행이 실패했어요.")); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error("codex 실행이 실패했어요."));
      else resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
    child.stdin.end(opts.input ?? "");
  });
}

// codex exec 인자. 사용자 Codex 설정(~/.codex/config.toml — MCP 서버·플러그인)은 읽지 않는다(--ignore-user-config, 로그인은 그대로).
// 그 MCP 엔 쓰기 도구(메일 보내기 등)가 섞여 있고 codex exec 는 승인 없이 부르므로, JSON 만 받는 이 경로엔 아예 붙이지 않는다.
// 셸은 읽기 전용 샌드박스, 세션 파일은 남기지 않는다(--ephemeral).
export const CODEX_ARGS = ["exec", "--skip-git-repo-check", "--json", "--sandbox", "read-only", "--ephemeral", "--ignore-user-config", "-"] as const;
export const CODEX_TIMEOUT_MS = 120_000;

export type CodexUsage = { inTokens: number; outTokens: number };

// turn.completed 의 usage(있으면). 없으면 0
export function parseCodexUsage(stdout: string): CodexUsage {
  let inTokens = 0, outTokens = 0;
  for (const line of stdout.split("\n")) {
    const rec = asRecord(tryParse(line.trim()));
    const u = rec?.type === "turn.completed" ? asRecord(rec.usage) : undefined;
    if (!u) continue;
    inTokens += Number(u.input_tokens ?? 0) || 0;
    outTokens += (Number(u.output_tokens ?? 0) || 0) + (Number(u.reasoning_output_tokens ?? 0) || 0);
  }
  return { inTokens, outTokens };
}

export type CodexOpts = { blocks?: ContentBlock[]; system?: string; execFile?: ExecFileLike; commandExists?: (name: string) => boolean; timeoutMs?: number };

// codex exec 한 번 → 마지막 답의 JSON + 토큰 수. 실패는 짧은 한국어(출력 본문은 넣지 않는다)
export async function codexExec(prompt: string, schema: unknown, opts: CodexOpts = {}): Promise<{ out: unknown; usage: CodexUsage }> {
  const exists = opts.commandExists ?? ((name: string) => commandOnPath(name));
  if (!exists("codex")) throw new Error(MISSING_CODEX);
  const exec = opts.execFile ?? defaultExecFile;
  if (opts.blocks?.some((b) => b.type !== "text")) throw new Error("Codex 연결은 텍스트 첨부만 지원해요. 이미지·PDF는 Claude Code나 API 키 연결로 보내 주세요");
  const input = [opts.system ?? "", prompt, ...(opts.blocks ?? []).map((b) => b.type === "text" ? b.text : ""), "도구를 부르지 말고 코드도 고치지 마라. 아래 JSON 스키마에 맞는 객체 하나만 답하라.", JSON.stringify(schema)].filter(Boolean).join("\n\n");
  let stdout = "";
  try {
    const result = await exec("codex", CODEX_ARGS, { input, timeout: opts.timeoutMs ?? CODEX_TIMEOUT_MS, cwd: tmpdir() });
    stdout = result.stdout;
  } catch (e) {
    throw new Error(/초과/.test(String((e as Error)?.message ?? "")) ? "codex 실행 시간이 초과됐어요." : "codex 실행이 실패했어요.");
  }
  return { out: parseCodexStdout(stdout), usage: parseCodexUsage(stdout) };
}

export async function codexJson(prompt: string, schema: unknown, opts: CodexOpts = {}): Promise<unknown> {
  return (await codexExec(prompt, schema, opts)).out;
}

export async function remoteJson(
  provider: Extract<BrainProvider, "gemini" | "openai" | "anthropic" | "codex">,
  cfg: Pick<Config, "brain" | "models">, prompt: string, schema: unknown,
  opts: { system?: string; model?: string; blocks?: ContentBlock[] } & ProviderDeps = {},
): Promise<unknown> {
  if (provider === "gemini") return geminiJson(cfg, prompt, schema, opts);
  if (provider === "openai") return openaiJson(cfg, prompt, schema, opts);
  if (provider === "anthropic") return anthropicJson(cfg, prompt, schema, opts);
  return codexJson(prompt, schema, opts);
}
