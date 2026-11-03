// Baixa o go2rtc (motor de vídeo, MIT, github.com/AlexxIT/go2rtc) da versão fixada para vendor/go2rtc.exe.
// Roda no npm install. Versão fixa: troca só aqui, de propósito.
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const VERSAO = 'v1.9.15';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'vendor', 'go2rtc.exe');

if (existsSync(destino)) {
  console.log(`go2rtc já está em ${destino}`);
} else {
  mkdirSync(join(raiz, 'vendor'), { recursive: true });
  const url = `https://github.com/AlexxIT/go2rtc/releases/download/${VERSAO}/go2rtc_win64.zip`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`não consegui baixar o go2rtc (${r.status})`);
  const zip = join(tmpdir(), `go2rtc-${VERSAO}.zip`);
  writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  const pasta = join(tmpdir(), `go2rtc-${VERSAO}`);
  rmSync(pasta, { recursive: true, force: true });
  // Expand-Archive do PowerShell: existe em todo Windows (o tar do Git Bash lê 'C:' como servidor remoto)
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${pasta}' -Force; Copy-Item -LiteralPath '${join(pasta, 'go2rtc.exe')}' -Destination '${destino}'`]);
  console.log(`go2rtc ${VERSAO} em ${destino}`);
}
