import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 고를 수 있는 캐릭터: 시사(기본)·하치와레·랏코·모몽가·우사기. 캐릭터마다 이름·말투(모델 프롬프트)·말투 양념(voice.ts)·
// 고정 문구 기본값(phrases.ts)·AI 없이 하는 정해진 말(local-mode.ts)이 다르다. 그림·영상은 데스크톱이 같은 id 로 고른다
// (assets/characters/<id>/, 시사는 예전 그대로 assets/character/).
// 고르는 곳: 설정 창 「캐릭터」 → PUT /settings { character } → config.json character. 데몬은 setCharacter 로 바로 바꾼다.
// 사용자가 설정 창 「문구」에서 고친 문구는 캐릭터와 상관없이 그대로 쓴다(phrases.ts).

export const CHARACTER_IDS = ["shisa", "hachi", "rakko", "momonga", "usagi"] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];
export const DEFAULT_CHARACTER: CharacterId = "shisa";
export const isCharacterId = (v: unknown): v is CharacterId => typeof v === "string" && (CHARACTER_IDS as readonly string[]).includes(v);

export type Mood = "happy" | "excited" | "calm" | "busy";

export type Character = {
  id: CharacterId;
  name: string; // 화면·프롬프트에 쓰는 이름
  intro: string; // 모델 프롬프트 첫 문장(누구인지)
  tone: string; // 모델 프롬프트 말투 한 줄
  // 고정 말풍선 양념(voice.ts): stretch = 「있어요」→「있어~요」, lead = 앞에 붙이는 감탄사, tail = 뒤에 붙이는 감정 표시
  stretch: boolean;
  lead?: Record<Mood, readonly string[]>;
  tail?: Record<Mood, readonly string[]>;
  phrases: Record<string, readonly string[]>; // phrases.ts 키 → 이 캐릭터의 기본 줄들(없는 키는 phrases.ts 기본값)
  lines: Partial<Record<LocalLineKey, string>>; // local-mode.ts 의 정해진 말(없는 키는 시사 말)
  cheer?: readonly string[]; // local-mode.ts 응원 칩
};

export type LocalLineKey =
  | "morning" | "lunch" | "afternoon" | "evening" | "remind" | "praise" | "empty" | "emptyHead" | "praiseDone"
  | "todayEmpty" | "todayPick" | "todayAll" | "todayNone" | "todaySome" | "todoEmpty" | "todoTop"
  | "calOff" | "calNone" | "calNow" | "calNext" | "calThen";

// 시사: 예전 말투 그대로(voice.ts TONE·MOODS, phrases.ts 기본값, local-mode.ts LINES)
const SHISA: Character = {
  id: "shisa",
  name: "시사",
  intro: "너는 사용자 개인 PC에 상주하는 비서 \"cy\"다.",
  tone: "존댓말로 짧고 다정하게. 가끔(네 번에 한 번 정도) 말끝을 '~요'처럼 늘이거나 '(기쁜 시사)' 같은 감정 표시를 붙여도 되지만, 오류·머지·결재처럼 진지한 내용에는 쓰지 않는다.",
  stretch: true,
  tail: {
    happy: ["(스이시~사)", "(기쁜 시사)", "(뿌듯한 시사)"],
    excited: ["(들뜬 시사)", "(스이시~사)"],
    calm: ["(안심한 시사)", "(스이시~사)"],
    busy: ["(비장한 시사)", "(집중하는 시사)"],
  },
  phrases: {},
  lines: {},
};

// 시사 외 캐릭터의 말은 전부 assets/characters/lines.json 에 있다(사람이 고치는 파일 — 데스크톱도 같은 파일을 쓴다).
// 레포에서도, 앱 번들(Resources/agent/src ↔ Resources/assets)에서도 ../../assets 다
export const LINES_FILE = fileURLToPath(new URL("../../assets/characters/lines.json", import.meta.url));
type LinesEntry = {
  name: string;
  prompt: { intro: string; tone: string; persona: string };
  flair: { lead?: Record<Mood, string[]>; tail?: Record<Mood, string[]> };
  phrases: Record<string, string[]>;
  local: Partial<Record<LocalLineKey, string>>;
  cheer: string[];
};
export const LINES_JSON = JSON.parse(readFileSync(LINES_FILE, "utf8")) as Record<string, unknown>;
function fromLines(id: Exclude<CharacterId, "shisa">): Character {
  const e = LINES_JSON[id] as LinesEntry;
  const nonEmpty = (r?: Record<Mood, string[]>) => (r && Object.keys(r).length ? r : undefined);
  return {
    id, name: e.name, intro: e.prompt.intro, tone: e.prompt.tone, stretch: false,
    lead: nonEmpty(e.flair?.lead), tail: nonEmpty(e.flair?.tail),
    phrases: e.phrases ?? {}, lines: e.local ?? {}, cheer: e.cheer,
  };
}

export const CHARACTERS: Record<CharacterId, Character> = { shisa: SHISA, hachi: fromLines("hachi"), rakko: fromLines("rakko"), momonga: fromLines("momonga"), usagi: fromLines("usagi") };

let current: CharacterId = DEFAULT_CHARACTER;
// config.json character(모르는 값이면 시사). 설정 창이 바꾸면 Settings 가 다시 부른다 — 다음 말풍선·답부터 바로
export function setCharacter(id: unknown): CharacterId {
  current = isCharacterId(id) ? id : DEFAULT_CHARACTER;
  return current;
}
export const characterId = (): CharacterId => current;
export const character = (): Character => CHARACTERS[current];
export const characterOptions = () => CHARACTER_IDS.map((id) => ({ id, name: CHARACTERS[id].name }));

// 프롬프트의 시사 첫 문장+말투(brain.ts BASE)를 지금 캐릭터 것으로 바꾼다. 시사면 그대로(프롬프트 캐시도 그대로)
export function withCharacter(system: string): string;
export function withCharacter(system: string | undefined): string | undefined;
export function withCharacter(system: string | undefined): string | undefined {
  if (!system || current === "shisa") return system;
  const c = character();
  return system.split(`${SHISA.intro} ${SHISA.tone}`).join(`${c.intro} ${c.tone}`).split(SHISA.tone).join(c.tone);
}
export const SHISA_PERSONA = `${SHISA.intro} ${SHISA.tone}`;
