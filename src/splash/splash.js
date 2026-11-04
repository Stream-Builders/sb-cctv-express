// Splash: o letreiro 3D (three.js) com a logo; sem WebGL, fica a logo plana.
import { montar } from './letreiro.js';

const canvas = document.getElementById('letreiro');
montar(canvas).catch(() => {
  const img = document.createElement('img');
  img.src = '../ui/marca/logo.svg';
  img.alt = 'cctv.express';
  img.className = 'plana';
  canvas.replaceWith(img);
});
