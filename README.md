<p align="center">
  <img src="midia/letreiro.gif" alt="cctv.express" width="800" />
</p>

<p align="center">
  <a href="https://cctvexpress.stream.builders">
    <img src="https://readme-typing-svg.demolab.com?font=Orbitron&weight=700&size=28&pause=1000&color=FF3333&center=true&vCenter=true&width=900&lines=CCTV+EXPRESS;VMS+open+source+para+c%C3%A2meras+IP;Ao+vivo+%C2%B7+Grava%C3%A7%C3%A3o+%C2%B7+Reprodu%C3%A7%C3%A3o+%C2%B7+PTZ+%C2%B7+Luz;Detec%C3%A7%C3%A3o+de+movimento+e+alertas;Sem+nuvem%2C+sem+mensalidade;Open+source+IP+camera+VMS+for+Windows" alt="CCTV Express" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/Stream-Builders/sb-cctv-express/releases/latest"><img src="https://img.shields.io/github/v/release/Stream-Builders/sb-cctv-express?style=for-the-badge&label=BAIXAR&labelColor=000000&color=FF3333" alt="Baixar" /></a>
  <a href="https://cctvexpress.stream.builders"><img src="https://img.shields.io/badge/SITE-000000?style=for-the-badge&logo=googlechrome&logoColor=FF3333" alt="Site" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/MIT-000000?style=for-the-badge&logo=opensourceinitiative&logoColor=FF3333" alt="Licença MIT" /></a>
  <img src="https://img.shields.io/badge/WINDOWS_10_%7C_11-000000?style=for-the-badge&logo=windows&logoColor=FF3333" alt="Windows" />
  <img src="https://img.shields.io/badge/18_IDIOMAS-000000?style=for-the-badge&logo=googletranslate&logoColor=FF3333" alt="18 idiomas" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-000000?style=for-the-badge&logo=electron&logoColor=FF3333" alt="Electron" />
  <img src="https://img.shields.io/badge/go2rtc-000000?style=for-the-badge&logo=webrtc&logoColor=FF3333" alt="go2rtc" />
  <img src="https://img.shields.io/badge/FFmpeg-000000?style=for-the-badge&logo=ffmpeg&logoColor=FF3333" alt="FFmpeg" />
  <img src="https://img.shields.io/badge/three.js-000000?style=for-the-badge&logo=threedotjs&logoColor=FF3333" alt="three.js" />
  <img src="https://img.shields.io/badge/ONVIF-000000?style=for-the-badge&logo=gnometerminal&logoColor=FF3333" alt="ONVIF" />
</p>

---

## 🎥 O que é

Monitoramento de câmeras IP (CCTV) para Windows, da **Stream.Builders**. O estado de cada câmera fica sempre visível, em
selos grandes e coloridos: **ao vivo**, **conectando**, **sem sinal**, **gravando** (o selo só acende quando o arquivo
está crescendo no disco) e **movimento**. Tudo roda no seu computador: o vídeo vai da câmera para o seu disco, sem
passar por servidor de ninguém.

### ⬇️ [Baixar para Windows](https://github.com/Stream-Builders/sb-cctv-express/releases/latest) · 🌐 [cctvexpress.stream.builders](https://cctvexpress.stream.builders)

---

## ✨ Recursos

- **Ao vivo em mosaico:** 1, 4, 9, 16, 25 ou 36 câmeras, reconexão automática, tela cheia com dois cliques, sem recomprimir.
- **Gravação contínua:** em `C:\cctv_express\records`, blocos de 120 minutos (ajustáveis), retenção por dias e por espaço livre.
- **Reprodução:** linha do tempo do dia com as marcas de movimento; marque início e fim e exporte o trecho em MP4.
- **PTZ e luz:** mova e aproxime segurando o botão; luz inteligente, colorida, infravermelho ou sempre acesa.
- **Detecção de movimento:** sensibilidade ajustável, selo na tela, marca na linha do tempo e aviso do Windows.
- **Encontra as câmeras:** ONVIF (WS-Discovery), RTSP e Xiongmai/iCSee/XMeye na sua rede.
- **Compatibilidade automática:** câmera com perfil H264 que o navegador recusa passa a ser reconvertida (com a placa de vídeo, se houver).
- **18 idiomas**, seguindo o idioma do Windows.

---

## 🛠️ Como funciona

| Peça | Papel |
|---|---|
| **Electron** | A janela do app (Windows; Mac depois). |
| **go2rtc** (MIT) | Motor de vídeo escondido, só em `127.0.0.1`: conecta nas câmeras, reconecta sozinho e entrega o vídeo ao vivo por WebSocket. |
| **FFmpeg** | Gravação em MP4 fragmentado sem recomprimir, detecção de movimento (filtro `scene`) e exportação de trechos. |
| **ONVIF / DVRIP** | PTZ e luz: Xiongmai pelo protocolo próprio (porta 34567), as demais marcas por ONVIF. |
| **three.js** | O letreiro 3D do splash e do site. |

- **Câmeras** ficam em `cameras.json` na pasta de dados do app. A senha é cifrada pelo Windows (safeStorage/DPAPI) e chega
  ao go2rtc só por variável de ambiente, nunca em arquivo aberto.
- **Visual:** as cores e a peça `.sb-btn` do tenant ebooks.express (`src/ui/tema/`, da `@ebx/temas`).

---

## 🚀 Desenvolvimento

```bash
npm install      # baixa o go2rtc e o ffmpeg nas versões fixadas e copia o three.js
npm start        # abre o app
npm run dist     # gera dist/CCTV Express Setup <versão>.exe (NSIS, Windows x64)
```

- **Letreiro em vídeo:** `electron scripts/gravar-letreiro.js midia` gera `midia/letreiro.mp4` e `midia/letreiro.gif`.
- **Site:** `site/` é a landing de [cctvexpress.stream.builders](https://cctvexpress.stream.builders) (Vercel, projeto
  `cctvexpress`). Antes do deploy, `node scripts/montar-site.mjs`; depois `npx vercel deploy --prod --yes` dentro de `site/`.

---

## 🗺️ Etapas

- [x] Ao vivo em mosaico com reconexão automática e estado visível
- [x] Gravação contínua em disco, com retenção por dias e espaço livre
- [x] Detecção de câmeras na rede, 18 idiomas, configurações e splash 3D
- [x] Reprodução com linha do tempo e exportação de trechos
- [x] PTZ e luz (Xiongmai e ONVIF)
- [x] Detecção de movimento e alertas
- [x] Instalador para Windows
- [ ] Interface pelo navegador na rede local (celular e outros computadores da casa)

---

## 📄 Licença

MIT. Veja [LICENSE](LICENSE). O app usa go2rtc (MIT), three.js (MIT) e FFmpeg (LGPL/GPL, baixado na instalação).

<p align="center">
  <a href="https://stream.builders"><img src="https://img.shields.io/badge/STREAM.BUILDERS-000000?style=for-the-badge&logoColor=FF3333" alt="Stream.Builders" /></a>
</p>
