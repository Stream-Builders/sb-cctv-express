// Redutor do ruído de fundo para o som ao vivo (expansor descendente). Mede o piso de ruído, o nível mais baixo da
// última janela de 0,75 a 1,5 s (vento constante, ventilador, chiado do equipamento), e abaixa o som quando ele fica
// perto desse piso, entre as falas. A voz, acima do piso, passa inteira. Só a tela usa: a gravação guarda o som
// original da câmera.
const JANELA_S = 0.75;

class VozRuido extends AudioWorkletProcessor {
  constructor() {
    super();
    this.piso = 0;
    this.minAtual = Infinity;
    this.minAnterior = Infinity;
    this.amostras = 0;
    this.ganho = 1;
    this.segura = 0;
  }

  process(entradas, saidas) {
    const ent = entradas[0];
    const sai = saidas[0];
    if (!ent || !ent.length || !sai || !sai.length) return true;
    const n = ent[0].length;
    let soma = 0;
    for (const canal of ent) for (let i = 0; i < n; i++) soma += canal[i] * canal[i];
    const rms = Math.sqrt(soma / (n * ent.length)) + 1e-9;
    // estatística de mínimos: o piso é o menor nível da janela atual e da anterior, alisado
    this.minAtual = Math.min(this.minAtual, rms);
    this.amostras += n;
    if (this.amostras >= JANELA_S * sampleRate) {
      this.minAnterior = this.minAtual;
      this.minAtual = Infinity;
      this.amostras = 0;
    }
    const alvoPiso = Math.min(this.minAtual, this.minAnterior);
    this.piso = this.piso ? this.piso + (alvoPiso - this.piso) * 0.05 : rms;
    // abre ~10 dB acima do piso e segura aberto 150 ms depois da fala (o fim das palavras não é cortado)
    const limiar = Math.max(this.piso, 1e-5) * 3.2;
    let alvo;
    if (rms >= limiar) {
      alvo = 1;
      this.segura = 0.15 * sampleRate;
    } else if (this.segura > 0) {
      alvo = 1;
      this.segura -= n;
    } else {
      // abaixo do limiar o ganho cai com o nível (expansor), até -18 dB
      alvo = Math.max(0.12, Math.pow(rms / limiar, 2));
    }
    // abre na hora e fecha em ~80 ms, com o ganho interpolado dentro do bloco (sem estalos)
    const coef = alvo > this.ganho ? 0.6 : 1 - Math.exp(-n / (0.08 * sampleRate));
    const novo = this.ganho + (alvo - this.ganho) * coef;
    for (let c = 0; c < sai.length; c++) {
      const e = ent[c] || ent[0];
      const s = sai[c];
      for (let i = 0; i < n; i++) s[i] = e[i] * (this.ganho + ((novo - this.ganho) * i) / n);
    }
    this.ganho = novo;
    return true;
  }
}

registerProcessor('voz-ruido', VozRuido);
