// Baixa os dois motores do app para vendor/, nas versões fixadas (troca só aqui, de propósito). Roda no npm install.
// - go2rtc (MIT, github.com/AlexxIT/go2rtc): conecta nas câmeras e entrega o vídeo ao vivo e para a gravação.
// - ffmpeg (compilação "essentials" do Gyan, github.com/GyanD/codexffmpeg): grava em blocos sem recomprimir.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(raiz, 'vendor'), { recursive: true });

const MOTORES = [
  {
    nome: 'go2rtc',
    versao: 'v1.9.15',
    url: (v) => `https://github.com/AlexxIT/go2rtc/releases/download/${v}/go2rtc_win64.zip`,
    // SHA-256 publicado pelo GitHub na release (campo digest do asset); o download só é gravado se bater
    sha256: '5b448fc90f15c925406d8da0984301985e385050222c1c2bbdf0a76fe4b1e9cb',
    dentro: 'go2rtc.exe',
    destino: 'go2rtc.exe',
  },
  {
    nome: 'ffmpeg',
    versao: '9.0.2',
    url: (v) => `https://github.com/GyanD/codexffmpeg/releases/download/${v}/ffmpeg-${v}-essentials_build.zip`,
    sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
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
  const temp = mkdtempSync(join(tmpdir(), `${m.nome}-`));
  const zip = join(temp, `${m.nome}-${m.versao}.zip`);
  const bytes = Buffer.from(await r.arrayBuffer());
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== m.sha256) throw new Error(`${m.nome} ${m.versao}: SHA-256 não confere (${hash}); arquivo descartado`);
  writeFileSync(zip, bytes);
  const pasta = join(temp, 'extraido');
  rmSync(pasta, { recursive: true, force: true });
  const dentro = typeof m.dentro === 'function' ? m.dentro(m.versao) : m.dentro;
  // Expand-Archive do PowerShell: existe em todo Windows (o tar do Git Bash lê 'C:' como servidor remoto)
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${pasta}' -Force; Copy-Item -LiteralPath '${join(pasta, dentro)}' -Destination '${destino}'`]);
  rmSync(temp, { recursive: true, force: true });
  console.log(`${m.nome} ${m.versao} em ${destino}`);
}
