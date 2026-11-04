// A ponte entre a tela e o processo principal: só estas funções ficam visíveis para a interface.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cctv', {
  listarCameras: () => ipcRenderer.invoke('cameras:listar'),
  salvarCamera: (dados) => ipcRenderer.invoke('cameras:salvar', dados),
  removerCamera: (id) => ipcRenderer.invoke('cameras:remover', id),
  definirGravacao: (id, ligar) => ipcRenderer.invoke('cameras:gravacao', id, ligar),
  detectarCameras: () => ipcRenderer.invoke('cameras:detectar'),
  capacidades: (id) => ipcRenderer.invoke('controle:capacidades', id),
  ptz: (id, direcao, parar) => ipcRenderer.invoke('controle:ptz', id, direcao, parar),
  luz: (id, modo) => ipcRenderer.invoke('controle:luz', id, modo),
  portaMotor: () => ipcRenderer.invoke('motor:porta'),
  estadosGravacao: () => ipcRenderer.invoke('gravacao:estados'),
  lerConfig: () => ipcRenderer.invoke('config:ler'),
  salvarConfig: (dados) => ipcRenderer.invoke('config:salvar', dados),
  escolherPasta: () => ipcRenderer.invoke('config:escolher-pasta'),
  abrirPastaGravacoes: () => ipcRenderer.invoke('config:abrir-pasta'),
  idiomaDoSistema: () => ipcRenderer.invoke('sistema:idioma'),
});
