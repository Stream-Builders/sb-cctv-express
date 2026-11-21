// Baixa os dois motores do app para vendor/, nas versões fixadas (troca só aqui, de propósito). Roda no npm install.
// - go2rtc (MIT, github.com/AlexxIT/go2rtc): conecta nas câmeras e entrega o vídeo ao vivo e para a gravação.
// - ffmpeg (compilação "essentials" do Gyan, github.com/GyanD/codexffmpeg): grava em blocos sem recomprimir.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
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
    versao: '9.1',
    url: (v) => `https://github.com/GyanD/codexffmpeg/releases/download/${v}/ffmpeg-${v}-essentials_build.zip`,
    sha256: 'b9bbbb3acece000cbeec994f856649354e52c773807841e78908374b24d658fd',
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
  // até 3 tentativas: o download do ffmpeg (100 MB) às vezes cai no meio no runner
  let bytesBaixados = null;
  for (let tentativa = 1; !bytesBaixados; tentativa++) {
    try {
      const r = await fetch(m.url(m.versao));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      bytesBaixados = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (tentativa >= 3) throw new Error(`não consegui baixar o ${m.nome}: ${e.message}`);
      console.log(`${m.nome}: download falhou (${e.message}), tentando de novo`);
      await new Promise((ok) => setTimeout(ok, 5000 * tentativa));
    }
  }
  const temp = mkdtempSync(join(tmpdir(), `${m.nome}-`));
  const zip = join(temp, `${m.nome}-${m.versao}.zip`);
  const bytes = bytesBaixados;
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== m.sha256) throw new Error(`${m.nome} ${m.versao}: SHA-256 não confere (${hash}); arquivo descartado`);
  writeFileSync(zip, bytes);
  const pasta = join(temp, 'extraido');
  rmSync(pasta, { recursive: true, force: true });
  mkdirSync(pasta, { recursive: true });
  const dentro = typeof m.dentro === 'function' ? m.dentro(m.versao) : m.dentro;
  // o tar do próprio Windows (System32, bsdtar: abre .zip e entende caminhos com a letra do disco); o do Git Bash lê 'C:' como servidor remoto, e
  // o Expand-Archive do PowerShell quebrou na imagem nova do runner (sem a sobrecarga de ExtractToDirectory, 20/11)
  execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', pasta]);
  copyFileSync(join(pasta, dentro), destino);
  rmSync(temp, { recursive: true, force: true });
  console.log(`${m.nome} ${m.versao} em ${destino}`);
}
