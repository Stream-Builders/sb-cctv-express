// Baixa os dois motores do app para vendor/, nas versões fixadas (troca só aqui, de propósito). Roda no npm install.
// - go2rtc (MIT, github.com/AlexxIT/go2rtc): conecta nas câmeras e entrega o vídeo ao vivo e para a gravação.
// - ffmpeg (compilação "essentials" do Gyan, github.com/GyanD/codexffmpeg): grava em blocos sem recomprimir.
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(raiz, 'vendor'), { recursive: true });

const MOTORES = [
  {
    nome: 'go2rtc',
    versao: 'v1.9.15',
    url: (v) => `https://github.com/AlexxIT/go2rtc/releases/download/${v}/go2rtc_win64.zip`,
    dentro: 'go2rtc.exe',
    destino: 'go2rtc.exe',
  },
  {
    nome: 'ffmpeg',
    versao: '9.0.2',
    url: (v) => `https://github.com/GyanD/codexffmpeg/releases/download/${v}/ffmpeg-${v}-essentials_build.zip`,
    dentro: (v) => `ffmpeg-${v}-essentials_build/bin/ffmpeg.exe`,
    destino: 'ffmpeg.exe',
  },
];

for (const m of MOTORES) {
  const destino = join(raiz, 'vendor', m.destino);
  if (existsSync(destino)) {
    console.log(`${m.nome} já está em ${destino}`);
    continue;
  }
  const r = await fetch(m.url(m.versao));
  if (!r.ok) throw new Error(`não consegui baixar o ${m.nome} (${r.status})`);
  const zip = join(tmpdir(), `${m.nome}-${m.versao}.zip`);
  writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  const pasta = join(tmpdir(), `${m.nome}-${m.versao}`);
  rmSync(pasta, { recursive: true, force: true });
  const dentro = typeof m.dentro === 'function' ? m.dentro(m.versao) : m.dentro;
  // Expand-Archive do PowerShell: existe em todo Windows (o tar do Git Bash lê 'C:' como servidor remoto)
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${pasta}' -Force; Copy-Item -LiteralPath '${join(pasta, dentro)}' -Destination '${destino}'`]);
  console.log(`${m.nome} ${m.versao} em ${destino}`);
}
