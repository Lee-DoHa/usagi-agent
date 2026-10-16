// 캐릭터 상태 — 순수 로직. 렌더러와 테스트가 같이 쓴다.
// 정지 그림: 눈 뜬 그림이 기본, 랜덤 간격으로 잠깐 눈 감은 그림(가끔 두 번 깜빡).
// 활동: 데몬 state { activity, runs, danceId } → 보여줄 것 'idle'(정지 그림) | 'studying'(공부 영상) | 'dancing'(춤 영상).
// 우선순위 dancing > studying > idle. 춤이 끝나면(데몬이 알리거나 로컬 상한) 그 전 상태로 돌아간다.
// 집중하기(focus.js): 집중 중이면 공부 영상, 일시정지면 기본 그림(데몬이 다른 일로 공부 중이면 그대로 공부 영상).

import { CHARACTER_LINES } from './character-lines.js';

export const CHAR_DIR = 'cy-asset://app/character';
// 정지 그림 대체 순서: 눈 뜬 그림 → 예전 개인 그림 → 번들 그림 → 번들 svg
export const STILL_SRCS = [`${CHAR_DIR}/eyes_open.png`, 'cy-asset://app/character.png', '../assets/character.png', '../assets/character.svg'];
export const VIDEOS = {
  studying: { src: `${CHAR_DIR}/studying.webm`, poster: `${CHAR_DIR}/studying.png` },
  dancing: { src: `${CHAR_DIR}/dance.webm`, poster: `${CHAR_DIR}/dance.png` },
};

// ---- 고를 수 있는 캐릭터(데몬 characters.ts 와 같은 id). 시사는 예전 자리(character/), 나머지는 characters/<id>/ ----
// study = 집중·공부 중(studying 자리), plan = 일정 알림·춤(dancing 자리). scene: 배경이 있는 장면이라 둥근 네모 카드로 보인다
// clips: 춤 영상 종류(데몬 state.danceClip: plan 일정 알림 · dance 춤춰 줘 · cheer 응원해 줘) → 그 캐릭터의 파일 이름. 없는 종류는 같은 파일을 다시 쓴다
export const CHARACTERS = {
  shisa: { name: '시사' },
  hachi: { name: '하치와레', blink: true, scenes: { cheer: true }, clips: { plan: 'plan', dance: 'plan', cheer: 'cheer' } },
  rakko: { name: '랏코', blink: true, scenes: { study: true, plan: true, dance: true }, clips: { plan: 'plan', dance: 'dance', cheer: 'plan' } },
  momonga: { name: '모몽가', blink: true, scenes: { study: true, plan: true, dance: true }, clips: { plan: 'plan', dance: 'dance', cheer: 'plan' } },
  usagi: { name: '우사기', blink: false, scenes: {}, clips: { plan: 'plan', dance: 'dance', cheer: 'cheer' } },
};
export const DANCE_CLIPS = ['plan', 'dance', 'cheer'];
export const CHARACTER_IDS = Object.keys(CHARACTERS);
export const DEFAULT_CHARACTER = 'shisa';
// 오버레이가 데몬 말 없이 스스로 띄우는 짧은 말(머지 결과를 먼저 보일 때·AI 없이 묻기 칩). 시사는 예전 글 그대로
const SHISA_SAY_LOCAL = { quickAi: '정해진 답으로 바로 알려 드릴게요. 무엇이 궁금하세요?', mergeDone: '머지했어요 🎉 (스이시~사)', mergeDeclined: '알겠어요, 머지는 안 할게요. PR은 열어 둘게요', quick: '무엇이 궁금하세요? AI 없이도 이건 바로 알려 드려요', quickLogin: 'Claude Code 로그인 전이라도 이건 바로 알려 드려요. 무엇이 궁금하세요?' };
// 다른 캐릭터 글은 assets/characters/lines.json 의 overlay
export const LOCAL_SAY = { shisa: SHISA_SAY_LOCAL, ...Object.fromEntries(Object.entries(CHARACTER_LINES).map(([id, c]) => [id, { ...SHISA_SAY_LOCAL, ...(c.overlay ?? {}) }])) };
export const localSay = (id) => LOCAL_SAY[okCharacter(id)];

// 화면에 쓰는 이름: 「하치와레」·「하치와레 비서」(앱 이름·메뉴·창 제목)
export const characterName = (id) => CHARACTERS[okCharacter(id)].name;
export const appName = (id) => `${characterName(id)} 비서`;
export const okCharacter = (id) => (typeof id === 'string' && Object.hasOwn(CHARACTERS, id) ? id : DEFAULT_CHARACTER);

// 캐릭터 하나의 그림·영상 주소. { dir, open, closed(없으면 null), stills(대체 순서), videos: { studying, dancing }, clips: { plan, dance, cheer } }
// videos.dancing 은 일정 알림(plan) 영상 — 춤춰 줘·응원해 줘는 clips 에서 고른다(clipFor)
export function characterAssets(id) {
  const cid = okCharacter(id);
  if (cid === 'shisa') return { id: cid, dir: CHAR_DIR, retina: true, open: `${CHAR_DIR}/eyes_open.png`, closed: `${CHAR_DIR}/eyes_closed.png`, stills: STILL_SRCS, videos: VIDEOS, clips: { plan: VIDEOS.dancing, dance: VIDEOS.dancing, cheer: VIDEOS.dancing } };
  const c = CHARACTERS[cid];
  const dir = `cy-asset://app/characters/${cid}`;
  const clip = (name) => ({ src: `${dir}/${name}.webm`, poster: `${dir}/${name}.png`, scene: !!c.scenes[name] });
  const clips = Object.fromEntries(DANCE_CLIPS.map((k) => [k, clip(c.clips[k])]));
  return {
    id: cid, dir, retina: false, open: `${dir}/eyes_open.png`, closed: c.blink ? `${dir}/eyes_closed.png` : null,
    stills: [`${dir}/eyes_open.png`, ...STILL_SRCS],
    videos: { studying: clip('study'), dancing: clips.plan },
    clips,
  };
}
// 춤 영상 하나: 종류(plan·dance·cheer, 모르면 plan) → { src, poster, scene }
export const clipFor = (a, kind) => a.clips[DANCE_CLIPS.includes(kind) ? kind : 'plan'];

// ---- 깜빡임 ----
export const BLINK = {
  minGap: 2500, maxGap: 7000,           // 다음 깜빡임까지
  reducedMinGap: 9000, reducedMaxGap: 16000, // 동작 줄이기: 드물게
  minClosed: 120, maxClosed: 180,       // 눈 감고 있는 시간
  doubleChance: 0.18, doubleGap: 140,   // 가끔 두 번(동작 줄이기면 안 함)
};

// rand: () => [0,1)
export function nextBlinkDelay(rand = Math.random, reduced = false) {
  const lo = reduced ? BLINK.reducedMinGap : BLINK.minGap;
  const hi = reduced ? BLINK.reducedMaxGap : BLINK.maxGap;
  return Math.round(lo + rand() * (hi - lo));
}

// 한 번의 깜빡임 = 눈 감기·뜨기 단계들. [{ closed: true, ms }, { closed: false, ms }, …] (마지막은 늘 뜬 상태로 끝)
export function blinkPlan(rand = Math.random, reduced = false) {
  const closed = () => Math.round(BLINK.minClosed + rand() * (BLINK.maxClosed - BLINK.minClosed));
  const steps = [{ closed: true, ms: closed() }];
  if (!reduced && rand() < BLINK.doubleChance) steps.push({ closed: false, ms: BLINK.doubleGap }, { closed: true, ms: closed() });
  steps.push({ closed: false, ms: 0 });
  return steps;
}

// ---- 활동 ----
export const ACTIVITIES = ['idle', 'studying', 'dancing'];
export const DANCE_MAX_MS = 15000; // 데몬이 춤 끝을 못 알려도(끊김 등) 이만큼 뒤엔 스스로 멈춘다

export function initialActivity() {
  return { studying: false, dancing: false, danceId: null, endedDance: null, connected: true };
}

// action: { type:'state', activity, runs, danceId } | { type:'danceEnd' } | { type:'connection', connected } | { type:'localDance', on }
//       | { type:'focus', active, paused }
export function activityReducer(s, a) {
  switch (a?.type) {
    case 'state': {
      const act = ACTIVITIES.includes(a.activity) ? a.activity : 'idle';
      const runs = Array.isArray(a.runs) ? a.runs.length : 0;
      const studying = act === 'studying' || (act === 'dancing' && runs > 0);
      const danceId = act === 'dancing' ? (typeof a.danceId === 'string' && a.danceId ? a.danceId : 'dance') : null;
      // 로컬에서 이미 끝낸 춤은 같은 id 로 다시 와도(재연결 등) 다시 추지 않는다
      const dancing = !!danceId && danceId !== s.endedDance;
      const danceClip = DANCE_CLIPS.includes(a.danceClip) ? a.danceClip : 'plan';
      return { ...s, studying, dancing, danceId, danceClip, connected: true };
    }
    case 'danceEnd': {
      let n = s;
      if (s.localDance) n = { ...n, localDance: false };
      if (s.dancing) n = { ...n, dancing: false, endedDance: s.danceId };
      return n;
    }
    // 앱이 스스로 추는 짧은 춤(뇌 연결 전 더블클릭 등) — 데몬과 끊겨 있어도 춘다
    case 'localDance':
      return { ...s, localDance: !!a.on, ...(a.on ? { localClip: DANCE_CLIPS.includes(a.clip) ? a.clip : 'dance' } : {}) };
    case 'focus':
      return { ...s, focus: a.active ? (a.paused ? 'paused' : 'on') : null };
    case 'connection':
      return a.connected ? { ...s, connected: true } : { ...initialActivity(), connected: false, endedDance: s.endedDance };
    default:
      return s;
  }
}

// 지금 틀 춤 영상 종류(viewOf 가 dancing 일 때)
export function danceClipOf(s) {
  return s.localDance ? (s.localClip ?? 'dance') : (s.danceClip ?? 'plan');
}

export function viewOf(s) {
  if (s.localDance) return 'dancing';
  if (!s.connected) return 'idle';
  return s.dancing ? 'dancing' : s.studying || s.focus === 'on' ? 'studying' : 'idle';
}
