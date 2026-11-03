// Emblema 3D: a mesma câmera empilhada em camadas no eixo Z forma a extrusão; as de trás escurecem e a da frente é a
// face acesa.
const CAMADAS = 22;
const el = document.getElementById('emblema');
for (let i = CAMADAS; i >= 0; i--) {
  const img = document.createElement('img');
  img.src = '../ui/marca/emblema.svg';
  img.alt = '';
  img.className = i === 0 ? 'camada camada--face' : 'camada';
  img.style.setProperty('--z', `${-i * 1.5}px`);
  img.style.setProperty('--luz', String(0.18 + 0.5 * (1 - i / CAMADAS)));
  el.append(img);
}
