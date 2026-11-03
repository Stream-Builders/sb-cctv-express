// A ponte entre a tela e o processo principal: só estas funções ficam visíveis para a interface.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cctv', {
  listarCameras: () => ipcRenderer.invoke('cameras:listar'),
  salvarCamera: (dados) => ipcRenderer.invoke('cameras:salvar', dados),
  removerCamera: (id) => ipcRenderer.invoke('cameras:remover', id),
  portaMotor: () => ipcRenderer.invoke('motor:porta'),
});
