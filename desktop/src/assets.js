// cy-asset:// — 개인 캐릭터 그림·영상(~/.cy-agent/assets)을 샌드박스 렌더러에 내주는 주소. 순수 로직.
// 원본은 레포의 assets/ (설치 때 ~/.cy-agent/assets 로 복사). 허용 목록에 있는 파일만, 경로 조작 없이 이름 그대로.
import { IMAGES } from './bubbles.js';

export const ASSET_SCHEME = 'cy-asset';
// 캐릭터 상태 그림·영상(character/): 눈 뜬·감은 정지 그림(+@2x), 공부 중·춤 영상(VP9 알파 webm)과 첫 장면 포스터
export const CHARACTER_FILES = [
  ['character/eyes_open.png', 'image/png'],
  ['character/eyes_closed.png', 'image/png'],
  ['character/eyes_open@2x.png', 'image/png'],
  ['character/eyes_closed@2x.png', 'image/png'],
  ['character/studying.webm', 'video/webm'],
  ['character/dance.webm', 'video/webm'],
  ['character/studying.png', 'image/png'],
  ['character/dance.png', 'image/png'],
];
// 고를 수 있는 캐릭터(characters/<id>/): 정지 그림 · 집중(study)·일정 알림(plan) 영상과 첫 장면
export const PICKABLE = ['hachi', 'rakko', 'momonga', 'usagi'];
export const PICKABLE_FILES = PICKABLE.flatMap((id) => [
  [`characters/${id}/eyes_open.png`, 'image/png'],
  ...(id === 'usagi' ? [] : [[`characters/${id}/eyes_closed.png`, 'image/png']]),
  [`characters/${id}/study.webm`, 'video/webm'],
  [`characters/${id}/plan.webm`, 'video/webm'],
  [`characters/${id}/study.png`, 'image/png'],
  [`characters/${id}/plan.png`, 'image/png'],
  [`characters/${id}/dance.webm`, 'video/webm'],
  [`characters/${id}/dance.png`, 'image/png'],
  [`characters/${id}/cheer.webm`, 'video/webm'],
  [`characters/${id}/cheer.png`, 'image/png'],
]);
export const ALLOWED = new Map([
  ['character.png', 'image/png'],
  ...CHARACTER_FILES,
  ...PICKABLE_FILES,
  ...IMAGES.map((n) => [`reactions/${n}.jpg`, 'image/jpeg']),
]);

// 'cy-asset://app/reactions/merge.jpg' → { rel: 'reactions/merge.jpg', type: 'image/jpeg' } | null
export function resolveAsset(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${ASSET_SCHEME}:` || u.hostname !== 'app' || u.search || u.username || u.password || u.port) return null;
  let rel;
  try { rel = decodeURIComponent(u.pathname).replace(/^\//, ''); } catch { return null; }
  const type = ALLOWED.get(rel);
  return type ? { rel, type } : null;
}

// 실제로 읽을 파일 후보(앞에서부터): 홈(CY_AGENT_HOME/assets, 사용자가 바꾼 그림) → 레포 assets/(설치 스크립트를 안 거친 새 사용자·테스트 홈)
// → 앱 번들 assets/(dmg 로 깐 앱: Contents/Resources/assets) → character.png 만 앱 번들 플레이스홀더.
// dirs: { user, repo, bundle, bundled } — 없는 것은 건너뛴다
export function assetCandidates(rel, dirs, join = (a, b) => `${a.replace(/\/$/, '')}/${b}`) {
  const out = [];
  if (dirs?.user) out.push(join(dirs.user, rel));
  if (dirs?.repo) out.push(join(dirs.repo, rel));
  if (dirs?.bundle) out.push(join(dirs.bundle, rel));
  if (rel === 'character.png' && dirs?.bundled) out.push(join(dirs.bundled, 'character.png'));
  return out;
}

// HTTP Range 헤더 → { start, end }(포함) | null(없음·여러 구간 → 전체) | 'invalid'(416).
// <video> 는 Range 로 끊어 읽고 되감는다(loop). 'bytes=a-b' · 'bytes=a-' · 'bytes=-n' 만.
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null; // 여러 구간·모르는 단위는 무시하고 전체를 준다(RFC 9110 허용)
  const [, a, b] = m;
  if (a === '' && b === '') return 'invalid';
  let start, end;
  if (a === '') { // 끝에서 n 바이트
    const n = Number(b);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return 'invalid';
  return { start, end };
}
