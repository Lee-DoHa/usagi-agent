// 생성 원본(artwork/usagi)을 앱용 512px PNG·VP9 알파 루프로 준비한다.
// 그림 자체는 imagegen으로 제작했다. 여기서는 크기·컨테이너와 짧은 이동 모션만 처리한다.
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
fs.mkdirSync(out, { recursive: true });

const stills = { idle: 'eyes_open', closed: 'eyes_closed', study: 'study', active: 'plan', cheer: 'cheer' };
for (const [input, output] of Object.entries(stills)) {
  ff('-i', path.join(source, `${input}.png`), '-vf',
    'format=rgba,premultiply=inplace=1,scale=448:448:flags=lanczos,unpremultiply=inplace=1,pad=512:512:32:32:color=0x00000000',
    '-frames:v', '1', '-pix_fmt', 'rgba', path.join(out, `${output}.png`));
}
// 알림·춤은 짧게 손을 내민 자세, 응원은 부채를 든 축하 자세. 공식 애니메이션 영상이 아니다.
const fps = 24, duration = 4;
const clips = {
  study: { input: 'study', x: '0', y: '2*sin(2*PI*t/4)', motion: 'gentle-bob' },
  plan: { input: 'plan', x: '0', y: '-8*(1-cos(2*PI*t))', motion: 'reminder-hop' },
  dance: { input: 'plan', x: '10*sin(2*PI*t)', y: '-5*(1-cos(4*PI*t))', motion: 'side-to-side' },
  cheer: { input: 'cheer', x: '0', y: '-12*(1-cos(2*PI*t))', motion: 'cheer-hop' },
};
const meta = {};
for (const [name, c] of Object.entries(clips)) {
  if (name !== c.input) fs.copyFileSync(path.join(out, `${c.input}.png`), path.join(out, `${name}.png`));
  const graph = `color=c=black@0:s=512x512:r=${fps}:d=${duration},format=rgba[bg];[0:v]format=rgba[sprite];[bg][sprite]overlay=x='${c.x}':y='${c.y}':format=auto:shortest=1,format=yuva420p[v]`;
  ff('-loop', '1', '-framerate', String(fps), '-i', path.join(out, `${c.input}.png`),
    '-filter_complex', graph, '-map', '[v]', '-an', '-t', String(duration),
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '32', '-auto-alt-ref', '0',
    path.join(out, `${name}.webm`));
  meta[name] = { file: `${name}.webm`, poster: `${name}.png`, size: 512, fps,
    frames: fps * duration, duration, scene: false, alpha: true,
    source: `artwork/usagi/${{ study: 'study', plan: 'active', cheer: 'cheer' }[c.input]}.png`, motion: c.motion };
}
fs.writeFileSync(path.join(out, 'video.json'), JSON.stringify(meta, null, 2) + '\n');
console.log('Usagi: 6 PNGs + 4 transparent VP9 loops → assets/characters/usagi');
