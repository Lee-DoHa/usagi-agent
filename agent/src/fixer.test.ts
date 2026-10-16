import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectTestCommand, isBlockedBash, mergePr, resolveRepo, slugify } from "./fixer.ts";

test("resolveRepo: 허용 루트 안의 git 레포만", () => {
  const root = mkdtempSync(join(tmpdir(), "cy-root-"));
  const repo = join(root, "app");
  mkdirSync(join(repo, "src"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  assert.ok(resolveRepo({ repoRoots: [root] }, join(repo, "src")).endsWith("/app"));
  const other = mkdtempSync(join(tmpdir(), "cy-other-"));
  assert.throws(() => resolveRepo({ repoRoots: [root] }, other), /허용된 레포 루트 밖/);
  assert.throws(() => resolveRepo({ repoRoots: [root] }, join(root, "../nope-xyz")), /없어/);
});

test("에이전트의 커밋·푸시·머지는 막고 테스트는 허용", () => {
  for (const c of ["git commit -m x", "git push origin main", "gh pr merge 1", "cd a && git push", "rm -rf ~/"]) assert.equal(isBlockedBash(c), true, c);
  for (const c of ["npm test", "git status", "git diff", "pnpm install", "rm -rf node_modules"]) assert.equal(isBlockedBash(c), false, c);
});

test("detectTestCommand", () => {
  const d = mkdtempSync(join(tmpdir(), "cy-t-"));
  assert.equal(detectTestCommand(d), undefined);
  writeFileSync(join(d, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  assert.deepEqual(detectTestCommand(d), ["npm", "test"]);
  writeFileSync(join(d, "pnpm-lock.yaml"), "");
  assert.deepEqual(detectTestCommand(d), ["pnpm", "test"]);
  // 파이썬: 워크트리 → 원래 체크아웃의 .venv, 없으면 uv · 시스템 python3
  const py = mkdtempSync(join(tmpdir(), "cy-py-")), main = mkdtempSync(join(tmpdir(), "cy-main-"));
  writeFileSync(join(py, "pyproject.toml"), ""); mkdirSync(join(py, "tests"));
  // Windows: venv 는 Scripts\python.exe, 시스템 파이썬은 python
  const win = process.platform === "win32";
  const [vbin, vpy] = win ? ["Scripts", "python.exe"] : ["bin", "python"];
  assert.deepEqual(detectTestCommand(py, main), [win ? "python" : "python3", "-m", "pytest", "-q"]);
  writeFileSync(join(py, "uv.lock"), "");
  assert.deepEqual(detectTestCommand(py, main), ["uv", "run", "pytest", "-q"]);
  mkdirSync(join(main, ".venv", vbin), { recursive: true }); writeFileSync(join(main, ".venv", vbin, vpy), "");
  assert.deepEqual(detectTestCommand(py, main), [join(main, ".venv", vbin, vpy), "-m", "pytest", "-q"]);
  mkdirSync(join(py, "venv", vbin), { recursive: true }); writeFileSync(join(py, "venv", vbin, vpy), "");
  assert.deepEqual(detectTestCommand(py, main), [join(py, "venv", vbin, vpy), "-m", "pytest", "-q"]);
});

test("slugify: 한글만이면 기본값", () => {
  assert.equal(slugify("Fix Button Color!"), "fix-button-color");
  assert.equal(slugify("버튼 색"), "change");
});


test("머지는 비동기로 승인 SHA를 고정하고 제한 시간 내 실행", async () => {
  let args: string[] = [], timeout: number | undefined;
  const result = await mergePr("https://github.com/o/r/pull/1", "a".repeat(40), async (_file, argv, _cwd, _env, limit) => { args = argv; timeout = limit; return "merged"; });
  assert.equal(result, "merged");
  assert.deepEqual(args.slice(-2), ["--match-head-commit", "a".repeat(40)]);
  assert.equal(timeout, 120000);
  await assert.rejects(mergePr("https://github.com/o/r/pull/1", "bad", async () => { throw new Error("must not run"); }), /커밋/);
});
