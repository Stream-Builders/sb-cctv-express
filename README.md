<p align="center"><img src="midia/letreiro.gif" alt="cctv.express" width="800"></p>

# CCTV Express

**[Baixar para Windows](https://github.com/Stream-Builders/sb-cctv-express/releases/latest)** · [cctvexpress.stream.builders](https://cctvexpress.stream.builders)

Monitoramento de câmeras IP (CCTV) para Windows, da Stream.Builders: ao vivo em mosaico, gravação, reprodução, PTZ e
luz, com o estado de cada câmera sempre visível (ao vivo, conectando, sem sinal, gravando).

## Como funciona

- **Electron** para a janela (Windows; pode rodar no Mac depois).
- **go2rtc** (MIT, github.com/AlexxIT/go2rtc) como motor de vídeo: roda escondido, só em `127.0.0.1`, conecta nas câmeras,
  reconecta sozinho e entrega o vídeo ao vivo para a tela por WebSocket, sem recomprimir. É baixado no `npm install`
  (versão fixa em `scripts/baixar-go2rtc.mjs`).
- **Câmeras** em `cameras.json` na pasta de dados do app. A senha fica cifrada pelo Windows (safeStorage/DPAPI) e chega
  ao go2rtc só por variável de ambiente, nunca em arquivo aberto.
- **Tipos de câmera:** Xiongmai / iCSee / XMeye (protocolo próprio, porta 34567), ONVIF e RTSP.
- **Gravação:** um ffmpeg por câmera lê o RTSP local do go2rtc e grava MP4 fragmentado sem recomprimir; o selo GRAVANDO só acende quando o arquivo está crescendo.
- **Visual:** as cores e a peça `.sb-btn` do tenant ebooks.express (`src/ui/tema/`, da `@ebx/temas`).

## Rodar

```
npm install
npm start
```

Gerar o instalador: `npm run dist` (saída em `dist/`).

## Etapas

1. Ao vivo em mosaico com reconexão automática e estado visível — **feito**
2. Gravação contínua em disco (padrão `C:\cctv_express\records`, blocos de 120 min ajustáveis, retenção por dias e espaço livre) — **feito**
   - Detecção de câmeras na rede (ONVIF WS-Discovery + portas 34567/554/8554), 18 idiomas, configurações e splash 3D — **feito**
3. Reprodução com linha do tempo e exportação de trechos (MP4 sem recomprimir) — **feito**
4. PTZ e luz (Xiongmai pelo DVRIP; PTZ ONVIF para as demais marcas) — **feito**
5. Detecção de movimento (sensibilidade ajustável), selo MOVIMENTO, marcas na linha do tempo e aviso do Windows — **feito**


## Instalar

`npm run dist` gera `dist/CCTV Express Setup <versão>.exe` (instalador NSIS para Windows x64, com go2rtc e ffmpeg embutidos).

## Licença

MIT. Veja [LICENSE](LICENSE). O app usa go2rtc (MIT), three.js (MIT) e FFmpeg (LGPL/GPL, baixado na instalação).
