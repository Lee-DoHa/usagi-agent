// imagegen 원본을 앱용 512px PNG·VP9 알파 루프로 준비한다.
// 새 동작은 생성한 2×2 시트의 실제 자세 네 장을 순서대로 재생한다.
// node desktop/scripts/prepare-usagi.mjs — ffmpeg(libvpx-vp9) 필요.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(root, 'artwork/usagi');
const out = path.join(root, 'assets/characters/usagi');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const ff = (...args) => execFileSync(ffmpeg, ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: 'inherit' });
const fit = 'format=rgba,premultiply=inplace=1,scale=448:448:flags=lanczos,unpremultiply=inplace=1,pad=512:512:32:32:color=0x00000000';
const spriteFit = 'format=rgba,premultiply=inplace=1,scale=416:416:flags=lanczos,unpremultiply=inplace=1,pad=512:512:48:48:color=0x00000000';
const encode = ['-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '32', '-auto-alt-ref', '0'];
const fps = 24, duration = 4;
fs.mkdirSync(out, { recursive: true });
const scratch = fs.mkdtempSync(path.join(out, '.frames-'));
const meta = {};
try {
  for (const [input, output] of Object.entries({ idle: 'eyes_open', study: 'study' })) {
    ff('-i', path.join(source, `${input}.png`), '-vf', fit, '-frames:v', '1', '-pix_fmt', 'rgba', path.join(out, `${output}.png`));
  }
  // 집중 그림은 유지한다. 이동만 준 무음 루프다.
  ff('-loop', '1', '-framerate', String(fps), '-i', path.join(out, 'study.png'),
    '-filter_complex', `color=c=black@0:s=512x512:r=${fps}:d=${duration},format=rgba[bg];[0:v]format=rgba[sprite];[bg][sprite]overlay=x=0:y='2*sin(2*PI*t/4)':format=auto:shortest=1,format=yuva420p[v]`,
    '-map', '[v]', '-t', String(duration), ...encode, path.join(out, 'study.webm'));
  meta.study = { file: 'study.webm', poster: 'study.png', size: 512, fps, frames: fps * duration, duration,
    scene: false, alpha: true, source: 'artwork/usagi/study.png', motion: 'gentle-bob' };

  for (const [sheet, names, poseFps, motion, jump] of [
    ['cheetara-sheet', ['plan', 'cheer'], 8, 'cheetara-wing-flap-jump', true],
    ['rap-sheet', ['dance'], 4, 'sunglasses-rap-four-poses', false],
  ]) {
    for (let i = 0; i < 4; i++) {
      const crop = `crop=iw/2:ih/2:${i % 2}*iw/2:${Math.floor(i / 2)}*ih/2`;
      ff('-i', path.join(source, `${sheet}.png`), '-vf', `${crop},${spriteFit}`, '-frames:v', '1', '-pix_fmt', 'rgba', path.join(scratch, `${i}.png`));
    }
    // 24fps 시간축에 자세를 반복 배치한다. 두 동작 모두 마지막 프레임 다음이 첫 자세로 이어진다.
    for (let frame = 0; frame < fps * duration; frame++) {
      const pose = Math.floor(frame * poseFps / fps) % 4;
      fs.copyFileSync(path.join(scratch, `${pose}.png`), path.join(scratch, `frame-${String(frame).padStart(3, '0')}.png`));
    }
    const first = names[0];
    fs.copyFileSync(path.join(scratch, '0.png'), path.join(out, `${first}.png`));
    // B안은 몸 옆 날개짓과 함께 0.5초마다 펄쩍 뛴다. 여백 안에서 최대 48px 올라간다.
    const graph = jump
      ? `color=c=black@0:s=512x512:r=${fps}:d=${duration},format=rgba[bg];[0:v]format=rgba[s];[bg][s]overlay=x=0:y='-24*(1-cos(4*PI*t))':format=auto:shortest=1,format=yuva420p[v]`
      : '[0:v]format=yuva420p[v]';
    ff('-framerate', String(fps), '-i', path.join(scratch, 'frame-%03d.png'), '-filter_complex', graph, '-map', '[v]',
      '-frames:v', String(fps * duration), ...encode, path.join(out, `${first}.webm`));
    for (const name of names) {
      if (name !== first) for (const ext of ['png', 'webm']) fs.copyFileSync(path.join(out, `${first}.${ext}`), path.join(out, `${name}.${ext}`));
      meta[name] = { file: `${name}.webm`, poster: `${name}.png`, size: 512, fps, frames: fps * duration, duration,
        scene: false, alpha: true, source: `artwork/usagi/${sheet}.png`, motion, poses: 4, poseFps, jumpPixels: jump ? 48 : 0 };
    }
  }
  fs.writeFileSync(path.join(out, 'video.json'), JSON.stringify(meta, null, 2) + '\n');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log('Usagi: 5 PNGs + 4 transparent VP9 loops → assets/characters/usagi');
