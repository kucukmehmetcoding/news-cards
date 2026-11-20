// Video yapımcısı: doğrulanmış bir açıklayıcıdan dikey Reels (1080x1920, 30 fps, H.264 + AAC) üretir.
// Yeni metin YAZILMAZ: her sahnenin seslendirmesi o slaytta zaten yazan, doğrulayıcıdan geçmiş cümledir
// (grafik sahnesinde ise yalnız TCMB serisinin ilk/son değeri). Sahne başına ayrı ses üretildiği için
// görüntü-ses senkronu kesindir: sahne süresi = o sahnenin ses süresi + kısa nefes.
// Ses: edge-tts (ücretsiz, tr-TR Neural). Görüntü: açıklayıcının çizilmiş slaytları, bulanık arka planlı 9:16 çerçevede yavaş yakınlaşma.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { root, settings } from '../newsroom/context.js';
import { log } from '../newsroom/desk.js';

const run = promisify(execFile);
const sh = (cmd, args) => run(cmd, args, { maxBuffer: 1 << 26, timeout: 300000 });

// edge-tts kurulu değilse uvx ile çalıştırılır (yerelde); CI'da pipx ile kurulur.
async function tts(text, file, voice) {
  const args = ['--voice', voice, '--rate', settings.reel.rate, '--text', text, '--write-media', file];
  try {
    await sh('edge-tts', args);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    await sh('uvx', ['edge-tts', ...args]);
  }
}

const duration = async (file) => Number((await sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])).stdout);

// Grafik sahnesi anlatımı veriden: "Dolar/TL son 30 günde 49,60 liradan 50,49 liraya yükseldi."
function chartLine(c) {
  const n = (v) => v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [a, b] = [c.first, c.last];
  const verb = b > a ? 'yükseldi' : b < a ? 'geriledi' : 'yatay seyretti';
  return `${c.name} son 30 günde ${n(a)} liradan ${n(b)} liraya ${verb}.`;
}

// Açıklayıcının slaytlarıyla aynı sırada anlatım listesi (templates.explainerPages sırası: kapak, grafikler, bölümler).
export function narration(post) {
  const x = post.analysis;
  return [x.hook, ...(post.charts ?? []).map(chartLine), x.changed, x.affects, x.next].filter(Boolean);
}

async function scene(img, text, i, dir, voice) {
  const audio = `${dir}/a${i}.mp3`;
  await tts(text, audio, voice);
  const dur = (await duration(audio)) + 0.45;
  const out = `${dir}/s${i}.mp4`;
  const frames = Math.ceil(dur * 30);
  await sh('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-loop', '1', '-framerate', '30', '-t', String(dur), '-i', img,
    '-i', audio,
    '-filter_complex',
    '[0]split[a][b];' +
      '[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:4,eq=brightness=-0.2[bg];' +
      `[b]scale=1080:1350,zoompan=z='min(1+0.05*on/${frames},1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1350:fps=30[fg];` +
      '[bg][fg]overlay=0:285,format=yuv420p[v]',
    '-map', '[v]', '-map', '1:a', '-af', 'apad', '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-r', '30',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k', out,
  ]);
  return { file: out, dur };
}

// post: derlenmiş açıklayıcı (images + analysis + charts). Dönüş: { file (public/cards altında ad), duration, scenes }.
// frames: Tasarımcı'nın çizdiği video kareleri (public/cards altında ad), slayt sırasıyla.
export async function makeReel(post, id, frames) {
  const lines = narration(post);
  if (lines.length !== frames.length) throw new Error(`sahne/kare sayısı tutmuyor (${lines.length}/${frames.length})`);
  const dir = `${root}data/video/${id}`;
  mkdirSync(dir, { recursive: true });
  try {
    const voice = settings.reel.voice;
    const scenes = [];
    for (const [i, img] of frames.entries()) scenes.push(await scene(`${root}public/cards/${img}`, lines[i], i, dir, voice));
    writeFileSync(`${dir}/list.txt`, scenes.map((s) => `file '${s.file}'`).join('\n'));
    const name = `${id}.mp4`;
    await sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`, '-c', 'copy', '-movflags', '+faststart', `${root}public/cards/${name}`]);
    const total = scenes.reduce((t, s) => t + s.dur, 0);
    log('video', 'rendered', id, { from: post.id, seconds: Math.round(total), scenes: scenes.length, voice });
    return { file: name, duration: Math.round(total * 10) / 10, narration: lines };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const f of frames) rmSync(`${root}public/cards/${f}`, { force: true });
  }
}

export const reelReady = (name) => existsSync(`${root}public/cards/${name}`);
