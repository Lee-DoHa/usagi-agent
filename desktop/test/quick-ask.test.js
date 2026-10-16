// AI 없이 더블클릭 → 고르는 질문 칩, 패널 연결 안내 카드 숨기기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { cannedReply } from '../src/canned.js';
import { QUICK_CHIPS, QUICK_ID, ASK_IDS, isAskId, quickBubble, normQuick, chipsOf, chipAction, answerBubble } from '../src/quick-ask.js';
import { normalizeBubble, clickTarget } from '../src/bubbles.js';
import { brainView, connectCard, chatLock } from '../src/brain-state.js';

const noAi = brainView({ status: { brain: { provider: 'local', label: '로컬', ready: true, local: true }, chat: false, coder: {}, connectors: [] } });

test('칩 목록: 질문 다섯 개(응원·춤 포함) + 마지막 AI 연결하기', () => {
  assert.deepEqual(QUICK_CHIPS.map((c) => c.label), ['오늘 할 일 얼마나 했어요?', '지금 할 일 뭐 있어요?', '다음 일정은요?', '응원해 줘', '춤춰 줘', 'AI 연결하기']);
  assert.deepEqual(ASK_IDS, ['today', 'next_todo', 'next_event', 'cheer', 'dance']);
  assert.ok(isAskId('cheer'));
  assert.ok(!isAskId('connect'));
  for (const c of QUICK_CHIPS) assert.ok(!c.label.includes('\u2014'));
});

test('quickBubble: 칩 말풍선이 normalizeBubble 을 거쳐도 칩이 남는다', () => {
  assert.equal(noAi.ready, false);
  const raw = quickBubble(noAi);
  assert.equal(raw.id, QUICK_ID);
  const b = normalizeBubble(raw);
  assert.deepEqual(b.quick, ['today', 'next_todo', 'next_event', 'cheer', 'dance', 'connect']);
  // AI가 있으면(입력창 ＋) 「AI 연결하기」는 빼고 같은 칩
  assert.deepEqual(quickBubble({ ready: true }).quick, ['today', 'next_todo', 'next_event', 'cheer', 'dance']);
  assert.ok(b.ttlMs > 0);
  assert.deepEqual(clickTarget(b).type === 'open', false); // 말풍선 자체는 어디로도 안 연다(칩만)
  assert.match(quickBubble({ ready: false, provider: 'claude-code', known: true }).text, /Claude Code 로그인 전/);
  assert.ok(!quickBubble(noAi).text.includes('\u2014'));
});

test('normQuick: 아는 id 만, 정해진 순서로', () => {
  assert.equal(normQuick(null), null);
  assert.equal(normQuick([]), null);
  assert.equal(normQuick(['nope']), null);
  assert.deepEqual(normQuick(['connect', 'cheer', 'x', 'today']), ['today', 'cheer', 'connect']);
  assert.equal(normalizeBubble({ id: 'a', text: 'hi', quick: ['evil'] }).quick, undefined);
  assert.deepEqual(chipsOf(['today', 'connect']).map((c) => c.id), ['today', 'connect']);
  assert.equal(chipsOf(['connect'])[0].connect, true);
});

test('chipAction: AI 연결하기는 마법사 뇌 단계, 나머지는 데몬에 묻기', () => {
  assert.deepEqual(chipAction('connect'), { type: 'open', section: 'setup', id: 'brain' });
  assert.deepEqual(chipAction('next_event'), { type: 'ask', id: 'next_event' });
  assert.equal(chipAction('rm -rf'), null);
});

test('answerBubble: 데몬 답 → 말풍선, 실패면 다시 눌러 달라고', () => {
  const ok = answerBubble('today', { ok: true, status: 200, data: { ok: true, answer: { id: 'today', text: '오늘 할 일 5개 중 3개 끝냈어요.', kind: 'info', open: { section: 'today' } } } });
  assert.deepEqual(ok, { id: 'local-ask-today', kind: 'info', ttlMs: 12000, text: '오늘 할 일 5개 중 3개 끝냈어요.', open: { section: 'today' }, openLabel: '오늘 할 일 보기' });
  const b = normalizeBubble(ok);
  assert.deepEqual(b.open, { section: 'today' });
  const todo = answerBubble('next_todo', { ok: true, data: { answer: { text: '지금은', kind: 'info', detail: '- P1 a', open: { section: 'todos' } } } });
  assert.equal(todo.detail, '- P1 a');
  assert.equal(todo.openLabel, '할 일 보기');
  const cal = answerBubble('next_event', { ok: true, data: { answer: { text: '캘린더를', kind: 'info', open: { section: 'setup', id: 'extras' } } } });
  assert.deepEqual(cal.open, { section: 'setup', id: 'extras' });
  assert.equal(answerBubble('cheer', { ok: true, data: { answer: { text: '힘내요', kind: 'done' } } }).kind, 'done');
  assert.equal(answerBubble('cheer', { ok: true, data: { answer: { text: 'x', kind: 'info', open: { section: 'evil' } } } }).open, undefined);
  for (const r of [{ ok: false, error: 'ECONNREFUSED' }, { ok: false, status: 400, data: { error: 'unknown id' } }, null, { ok: true, data: { answer: { text: '  ' } } }]) {
    const f = answerBubble('today', r);
    assert.match(f.text, /다시 눌러 주세요/);
    assert.equal(f.id, 'local-ask-today');
  }
});

test('chatLock: AI 없으면 카드, 숨겼으면 다시 보기 링크만, AI 있으면 둘 다 없음', () => {
  assert.deepEqual(chatLock(noAi, false), { locked: true, card: true, reopen: false });
  assert.deepEqual(chatLock(noAi, true), { locked: true, card: false, reopen: true });
  const ai = brainView({ status: { brain: { provider: 'gemini', label: 'Gemini', ready: true }, chat: true, coder: {}, connectors: [] } });
  assert.deepEqual(chatLock(ai, true), { locked: false, card: false, reopen: false });
  assert.deepEqual(chatLock(ai, false), { locked: false, card: false, reopen: false });
  assert.deepEqual(chatLock({ ready: true }, false).locked, false);
  const card = connectCard(noAi);
  assert.equal(card.title, '지금은 AI 없이 쓰는 중이에요');
  assert.equal(card.hide, '숨기기');
  assert.equal(card.reopen, 'AI 연결 안내 보기');
});

// 실제 IPC 처리기를 실행해 패널 → 캐릭터 전달을 검증한다. Electron 창만 대신한다.
test('패널 춤·응원: 답을 캐릭터 말풍선에도 전달하며 캐릭터 칩은 중복 전달하지 않는다', async () => {
  const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const start = source.indexOf("  ipcMain.handle('local-ask',");
  const end = source.indexOf('  // 집중하기(포커스 타이머)', start);
  assert.ok(start >= 0 && end > start);
  let handler;
  const overlay = {}, panel = {}, stranger = {}, sent = [], calls = [];
  let response = { ok: true, data: { answer: { text: '이-야~ 야하 야하! 우-라 푸루푸루 하! 우라~!', kind: 'done' } } };
  runInNewContext(source.slice(start, end), {
    ipcMain: { handle: (_name, fn) => { handler = fn; } },
    win: { webContents: overlay }, panel: { webContents: panel },
    isAskId, answerBubble, denied: () => ({ ok: false }),
    post: async (url, body) => { calls.push({ url, body }); return response; },
    send: (channel, payload) => sent.push({ channel, payload }), console: { warn() {} },
  });
  for (const id of ['dance', 'cheer']) {
    assert.equal(await handler({ sender: panel }, id), response);
    assert.equal(sent.at(-1).channel, 'bubble');
    assert.equal(sent.at(-1).payload.text, response.data.answer.text);
    assert.equal(sent.at(-1).payload.id, `local-ask-${id}`);
  }
  assert.equal(sent.length, 2);
  await handler({ sender: overlay }, 'dance');
  assert.equal(sent.length, 2, '캐릭터 칩은 자신의 렌더러가 답을 그린다');
  const count = calls.length;
  await handler({ sender: stranger }, 'dance');
  await handler({ sender: panel }, 'unknown');
  assert.equal(calls.length, count, '다른 창·모르는 명령은 데몬에 보내지 않는다');
  response = { ok: false, error: 'ECONNREFUSED' };
  await handler({ sender: panel }, 'dance');
  assert.match(sent.at(-1).payload.text, /다시 눌러 주세요/);
});

test('우사기 춤: 패널의 정해진 답도 요청한 대사를 그대로 쓴다', () => {
  assert.equal(cannedReply('dance', {}, { character: 'usagi' }), '이-야~ 야하 야하! 우-라 푸루푸루 하! 우라~!');
});
