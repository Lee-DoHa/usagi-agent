import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { converse } from "./chat.ts";
import { loadConfig } from "./config.ts";
import { Store } from "./store.ts";
import type { Attachment, ContentBlock } from "./attachments.ts";
import { codexExec } from "./providers.ts";
import { attachmentInput } from "./attachments.ts";
import { ask, SCHEMA } from "./brain.ts";
import { assertStrict } from "./fixtures/assert-strict.ts";

test("API 공급자: DB 맥락과 첨부 내용이 실제 요청 본문에 들어간다", async () => {
  const original = globalThis.fetch;
  const store = new Store(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "cy-input-")), path = join(dir, "memo.txt");
  writeFileSync(path, "FILE_BODY_MARKER");
  store.addTodo({ title: "DB_TODO_MARKER", priority: 1 });
  const thread = store.createThread({ title: "test" });
  const attachments: Attachment[] = [{ id: "12345678-1234-1234-1234-123456789012", name: "memo.txt", mime: "text/plain", size: 16, kind: "text", file: "memo.txt", path }];
  try {
    for (const provider of ["gemini", "openai", "anthropic"] as const) {
      let captured: any;
      globalThis.fetch = async (_url, init) => {
        captured = JSON.parse(init?.body as string);
        const text = JSON.stringify({ reply_md: "ok", bubble: "ok", show: null });
        return new Response(JSON.stringify(provider === "gemini" ? { candidates: [{ content: { parts: [{ text }] } }] } : provider === "openai" ? { choices: [{ message: { content: text } }] } : { content: [{ type: "text", text }] }));
      };
      const cfg = { ...loadConfig({}), contextMode: "tools" as const, readSessions: false, repoRoots: [], brain: { provider, geminiApiKey: "fake", openaiApiKey: "fake", anthropicApiKey: "fake" } };
      await converse(cfg, store, [], "할 일과 파일을 알려줘", () => {}, "", undefined, thread.id, undefined, undefined, undefined, attachments);
      const wire = JSON.stringify(captured);
      assert.ok(wire.includes("DB_TODO_MARKER"), provider);
      assert.ok(wire.includes("FILE_BODY_MARKER"), provider);
      if (provider === "openai") assertStrict(captured.response_format.json_schema.schema);
    }
  } finally { globalThis.fetch = original; store.db.close(); }
});

test("공급자별 이미지·PDF 입력은 경로가 아니라 실제 데이터 블록", async () => {
  const blocks: ContentBlock[] = [
    { type: "image", source: { type: "base64", media_type: "image/png", data: "PNG_MARKER" } },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: "PDF_MARKER" }, title: "memo.pdf" },
  ];
  for (const provider of ["gemini", "openai", "anthropic"] as const) {
    let body: any;
    await ask({ ...loadConfig({}), brain: { provider, geminiApiKey: "fake", openaiApiKey: "fake", anthropicApiKey: "fake" } }, "read", SCHEMA, undefined, { blocks, deps: { env: {}, fetch: async (_url, init) => {
      body = JSON.parse(init?.body ?? "{}");
      const text = JSON.stringify({ bubble: "ok", reply_md: "ok", todos: [], done_todo_ids: [], proposals: [] });
      return new Response(JSON.stringify(provider === "gemini" ? { candidates: [{ content: { parts: [{ text }] } }] } : provider === "openai" ? { choices: [{ message: { content: text } }] } : { content: [{ type: "text", text }] }));
    } } });
    if (provider === "gemini") assert.deepEqual(body.contents[0].parts.slice(1).map((b: any) => b.inlineData.mimeType), ["image/png", "application/pdf"]);
    if (provider === "openai") assert.deepEqual(body.messages.at(-1).content.slice(1).map((b: any) => b.type), ["image_url", "file"]);
    if (provider === "anthropic") assert.deepEqual(body.messages[0].content.slice(1).map((b: any) => b.type), ["image", "document"]);
    assert.ok(JSON.stringify(body).includes("PNG_MARKER") && JSON.stringify(body).includes("PDF_MARKER"));
  }
});


test("Codex 텍스트 첨부는 stdin에 포함하고 미지원 바이너리는 실행 전에 안내", async () => {
  let input = "", calls = 0;
  const execFile = async (_file: string, _args: readonly string[], opts: any) => { calls++; input = opts.input; return { stdout: '{"reply":"ok"}' }; };
  await codexExec("read", {}, { commandExists: () => true, execFile, blocks: [{ type: "text", text: "CODEX_FILE_MARKER" }] });
  assert.ok(input.includes("CODEX_FILE_MARKER"));
  await assert.rejects(codexExec("read", {}, { commandExists: () => true, execFile, blocks: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "fake" } }] }), /텍스트 첨부/);
  assert.equal(calls, 1);
  assert.throws(() => attachmentInput([{ id: "fake", name: "report.docx", file: "fake.docx", mime: "application/octet-stream", kind: "file", size: 4 }], "thread", { inlineOnly: true, read: () => Buffer.from("fake") }), /전달할 수 없어요/);
});
