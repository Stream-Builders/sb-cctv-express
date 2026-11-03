# CCTV Express

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
- **Visual:** as cores e a peça `.sb-btn` do tenant ebooks.express (`src/ui/tema/`, da `@ebx/temas`).

## Rodar

```
npm install
npm start
```

Gerar o instalador: `npm run dist` (saída em `dist/`).

## Etapas

1. Ao vivo em mosaico com reconexão automática e estado visível — **feito**
2. Gravação contínua em disco, com limite e rotação
3. Reprodução com linha do tempo e exportação de trechos
4. PTZ e luz (branca e infravermelho)
5. Detecção de movimento e alertas
