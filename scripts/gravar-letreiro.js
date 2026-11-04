// Grava o letreiro 3D quadro a quadro (o relógio do letreiro é avançado por fora: sem engasgo) e monta MP4 e GIF com
// o ffmpeg do app. A janela precisa ficar visível durante a gravação (o WebGL não desenha em janela escondida).
//   electron scripts/gravar-letreiro.js <pasta de saída> [largura] [altura] [segundos] [qps]
const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('.js'));
const [saida, W = '1280', H = '640', SEG = '6', QPS = '30'] = args;

app.whenReady().then(async () => {
  try {
    const quadros = join(saida, 'quadros');
    mkdirSync(quadros, { recursive: true });
    const w = new BrowserWindow({ width: +W, height: +H, show: false, frame: false, skipTaskbar: true, useContentSize: true });
    await w.loadFile(join(__dirname, '..', 'src', 'splash', 'splash.html'), { query: { gravar: '1' } });
    w.show();
    for (let i = 0; i < 50 && !(await w.webContents.executeJavaScript('!!window.letreiroPronto')); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 800));
    const total = Math.round(+SEG * +QPS);
    for (let i = 0; i < total; i++) {
      await w.webContents.executeJavaScript(`window.letreiroEm(${(i / +QPS).toFixed(4)})`);
      const img = await w.webContents.capturePage();
      writeFileSync(join(quadros, `q${String(i).padStart(4, '0')}.png`), img.toPNG());
    }
    const ff = join(__dirname, '..', 'vendor', 'ffmpeg.exe');
    const entrada = join(quadros, 'q%04d.png');
    execFileSync(ff, ['-y', '-loglevel', 'error', '-framerate', QPS, '-i', entrada, '-vf', `scale=${W}:${H}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', join(saida, 'letreiro.mp4')]);
    execFileSync(ff, ['-y', '-loglevel', 'error', '-framerate', QPS, '-i', entrada, '-vf',
      'fps=20,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', join(saida, 'letreiro.gif')]);
    console.log('ok', total, 'quadros');
  } catch (e) {
    console.log('erro', e.message);
  }
  app.quit();
});
