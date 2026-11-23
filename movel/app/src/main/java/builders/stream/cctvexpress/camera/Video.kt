// O vídeo e o som ao vivo de uma câmera: o que chega da rede (RTSP ou DVRIP) vai direto ao decodificador do aparelho
// (MediaCodec) e dele à tela, sem buffer de reprodução. É o mesmo caminho do ao vivo do computador: a imagem aparece
// assim que o quadro chega, e um quadro que o decodificador não aceita a tempo é descartado (ao vivo não atrasa).
package builders.stream.cctvexpress.camera

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Build
import android.view.Surface

/** O que as fontes (RTSP, DVRIP) entregam: quadros de vídeo em Annex-B e o som. */
interface Destino {
  /** um quadro inteiro (todas as fatias), com código de início; chave = quadro que abre a decodificação */
  fun video(mime: String, quadro: ByteArray, chave: Boolean)
  /** som já em PCM de 16 bits */
  fun pcm(amostras: ShortArray, n: Int, taxa: Int, canais: Int)
  /** um quadro AAC cru (sem ADTS) e a configuração dele (AudioSpecificConfig) */
  fun aac(quadro: ByteArray, taxa: Int, canais: Int, config: ByteArray)
  /** se o som está ligado agora (sem som, a fonte nem decodifica o áudio) */
  val comSom: Boolean
}

/** destino que não recebe nada (só para conferir o login de uma câmera) */
object SemDestino : Destino {
  override fun video(mime: String, quadro: ByteArray, chave: Boolean) {}
  override fun pcm(amostras: ShortArray, n: Int, taxa: Int, canais: Int) {}
  override fun aac(quadro: ByteArray, taxa: Int, canais: Int, config: ByteArray) {}
  override val comSom = false
}

/** Os códigos de início e os tipos de NAL do H.264 e do H.265. */
object Nal {
  const val AVC = MediaFormat.MIMETYPE_VIDEO_AVC
  const val HEVC = MediaFormat.MIMETYPE_VIDEO_HEVC
  val INICIO = byteArrayOf(0, 0, 0, 1)

  /** as unidades NAL (sem o código de início) de um trecho em Annex-B */
  fun separar(b: ByteArray, de: Int = 0, ate: Int = b.size): List<Pair<Int, Int>> {
    val r = ArrayList<Pair<Int, Int>>()
    var i = de
    var ini = -1
    while (i + 3 <= ate) {
      if (b[i].toInt() == 0 && b[i + 1].toInt() == 0 && b[i + 2].toInt() == 1) {
        if (ini >= 0) r += ini to (if (i > de && b[i - 1].toInt() == 0) i - 1 else i)
        ini = i + 3
        i += 3
      } else i++
    }
    if (ini >= 0 && ini < ate) r += ini to ate
    return r
  }

  fun tipo(mime: String, primeiro: Byte): Int =
    if (mime == HEVC) (primeiro.toInt() shr 1) and 0x3f else primeiro.toInt() and 0x1f

  fun eChave(mime: String, t: Int) = if (mime == HEVC) t in 16..21 else t == 5

  /** VPS/SPS/PPS (H.265) ou SPS/PPS (H.264) */
  fun eParametro(mime: String, t: Int) = if (mime == HEVC) t in 32..34 else t == 7 || t == 8

  /** o codec pelo primeiro NAL do quadro-chave: VPS (H.265) ou SPS/PPS/SEI/AUD (H.264) */
  fun mimeDe(b: ByteArray): String? {
    val n = separar(b).firstOrNull() ?: return null
    val x = b[n.first].toInt() and 0xff
    return when {
      (x shr 1) and 0x3f in 32..40 && (x and 0x81) == 0 -> HEVC
      x and 0x1f in 6..9 || x and 0x1f == 5 -> AVC
      else -> null
    }
  }
}

/** O decodificador de vídeo de um quadro do mosaico, desenhando na superfície dele. */
class Decodificador(
  private val superficie: Surface,
  private val aoTamanho: (Int, Int) -> Unit,
  private val aoQuadro: () -> Unit,
) {
  private var codec: MediaCodec? = null
  private var mime = ""
  private var saida: Thread? = null
  @Volatile private var ativo = true
  @Volatile var erro: Exception? = null

  fun entregar(mime: String, dado: ByteArray, chave: Boolean) {
    erro?.let { throw it }
    if (codec == null || mime != this.mime) {
      // o decodificador só começa num quadro-chave (com VPS/SPS/PPS)
      if (!chave) return
      soltarCodec()
      configurar(mime, dado)
    }
    val c = codec ?: return
    val i = c.dequeueInputBuffer(30_000)
    if (i < 0) return // cheio: ao vivo, o quadro fica de fora
    val b = c.getInputBuffer(i) ?: return
    b.clear()
    if (dado.size > b.capacity()) { c.queueInputBuffer(i, 0, 0, System.nanoTime() / 1000, 0); return }
    b.put(dado)
    c.queueInputBuffer(i, 0, dado.size, System.nanoTime() / 1000, if (chave) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
  }

  private fun configurar(mime: String, chave: ByteArray) {
    val f = MediaFormat.createVideoFormat(mime, 1920, 1080)
    // os conjuntos de parâmetros do quadro-chave vão como configuração inicial (csd)
    val ps = Nal.separar(chave).filter { Nal.eParametro(mime, Nal.tipo(mime, chave[it.first])) }
    fun junta(lista: List<Pair<Int, Int>>) = lista.fold(ByteArray(0)) { a, (de, ate) -> a + Nal.INICIO + chave.copyOfRange(de, ate) }
    if (mime == Nal.HEVC) {
      if (ps.isNotEmpty()) f.setByteBuffer("csd-0", java.nio.ByteBuffer.wrap(junta(ps)))
    } else {
      val sps = ps.filter { Nal.tipo(mime, chave[it.first]) == 7 }
      val pps = ps.filter { Nal.tipo(mime, chave[it.first]) == 8 }
      if (sps.isNotEmpty() && pps.isNotEmpty()) {
        f.setByteBuffer("csd-0", java.nio.ByteBuffer.wrap(junta(sps)))
        f.setByteBuffer("csd-1", java.nio.ByteBuffer.wrap(junta(pps)))
      }
    }
    f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 4 * 1024 * 1024)
    f.setInteger(MediaFormat.KEY_PRIORITY, 0) // tempo real
    if (Build.VERSION.SDK_INT >= 30) f.setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
    val c = MediaCodec.createDecoderByType(mime)
    c.configure(f, superficie, null, 0)
    c.start()
    codec = c
    this.mime = mime
    ativo = true
    saida = Thread({ drenar(c) }, "decodificador").also { it.start() }
  }

  /** tudo o que sai do decodificador vai à tela na hora */
  private fun drenar(c: MediaCodec) {
    val info = MediaCodec.BufferInfo()
    try {
      while (ativo) {
        val i = c.dequeueOutputBuffer(info, 20_000)
        when {
          i >= 0 -> { c.releaseOutputBuffer(i, true); aoQuadro() }
          i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val f = c.outputFormat
            var w = f.getInteger(MediaFormat.KEY_WIDTH)
            var h = f.getInteger(MediaFormat.KEY_HEIGHT)
            if (f.containsKey("crop-right") && f.containsKey("crop-left")) w = f.getInteger("crop-right") - f.getInteger("crop-left") + 1
            if (f.containsKey("crop-bottom") && f.containsKey("crop-top")) h = f.getInteger("crop-bottom") - f.getInteger("crop-top") + 1
            if (w > 0 && h > 0) aoTamanho(w, h)
          }
        }
      }
    } catch (e: Exception) {
      if (ativo) erro = e
    }
  }

  private fun soltarCodec() {
    ativo = false
    saida?.join(500)
    saida = null
    try { codec?.stop() } catch (_: Exception) {}
    try { codec?.release() } catch (_: Exception) {}
    codec = null
  }

  fun soltar() = soltarCodec()
}

/** O som ao vivo: PCM direto no AudioTrack; AAC passa antes pelo decodificador de áudio do aparelho. */
class Som {
  private var faixa: AudioTrack? = null
  private var taxa = 0
  private var canais = 0
  private var aac: MediaCodec? = null
  private var configAac: ByteArray? = null
  private val info = MediaCodec.BufferInfo()

  fun pcm(a: ShortArray, n: Int, taxa: Int, canais: Int) {
    val t = faixa(taxa, canais)
    // sem bloquear a rede: o que não cabe agora é descartado (melhor um corte do que o som atrasar)
    t.write(a, 0, n, AudioTrack.WRITE_NON_BLOCKING)
  }

  fun aac(q: ByteArray, taxa: Int, canais: Int, config: ByteArray) {
    if (aac == null || !config.contentEquals(configAac)) {
      soltarAac()
      val f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, taxa, canais)
      f.setByteBuffer("csd-0", java.nio.ByteBuffer.wrap(config))
      f.setInteger(MediaFormat.KEY_IS_ADTS, 0)
      aac = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_AAC).apply { configure(f, null, null, 0); start() }
      configAac = config
    }
    val c = aac ?: return
    val i = c.dequeueInputBuffer(10_000)
    if (i >= 0) {
      val b = c.getInputBuffer(i) ?: return
      b.clear()
      b.put(q, 0, minOf(q.size, b.capacity()))
      c.queueInputBuffer(i, 0, minOf(q.size, b.capacity()), System.nanoTime() / 1000, 0)
    }
    while (true) {
      val o = c.dequeueOutputBuffer(info, 0)
      if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) continue
      if (o < 0) break
      val b = c.getOutputBuffer(o)
      if (b != null && info.size > 0) {
        val f = c.outputFormat
        val sb = b.order(java.nio.ByteOrder.nativeOrder()).asShortBuffer()
        val n = info.size / 2
        val a = ShortArray(n)
        sb.position(info.offset / 2)
        sb.get(a, 0, n)
        pcm(a, n, f.getInteger(MediaFormat.KEY_SAMPLE_RATE), f.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
      }
      c.releaseOutputBuffer(o, false)
    }
  }

  private fun faixa(taxa: Int, canais: Int): AudioTrack {
    faixa?.let { if (taxa == this.taxa && canais == this.canais) return it }
    soltarFaixa()
    val mascara = if (canais >= 2) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO
    val minimo = AudioTrack.getMinBufferSize(taxa, mascara, AudioFormat.ENCODING_PCM_16BIT)
    val t = AudioTrack.Builder()
      .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      .setAudioFormat(AudioFormat.Builder().setSampleRate(taxa).setChannelMask(mascara).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
      // 250 ms de folga: absorve a chegada irregular dos pacotes pela rede
      .setBufferSizeInBytes(maxOf(minimo, taxa * canais * 2 / 4))
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    t.play()
    faixa = t
    this.taxa = taxa
    this.canais = canais
    return t
  }

  private fun soltarFaixa() {
    try { faixa?.stop() } catch (_: Exception) {}
    faixa?.release()
    faixa = null
  }

  private fun soltarAac() {
    try { aac?.stop() } catch (_: Exception) {}
    try { aac?.release() } catch (_: Exception) {}
    aac = null
  }

  /** som desligado: para de tocar já (o que estava no buffer não continua saindo) */
  fun calar() {
    faixa?.let { try { it.pause(); it.flush(); it.play() } catch (_: Exception) {} }
  }

  fun soltar() { soltarAac(); soltarFaixa() }
}

/** G.711 (lei A e lei µ), o som da maioria das câmeras: 8 bits por amostra para 16 bits. */
object G711 {
  private val A = ShortArray(256) { i ->
    val a = i xor 0x55
    var t = (a and 0x0f) shl 4
    val seg = (a and 0x70) shr 4
    t = when (seg) { 0 -> t + 8; 1 -> t + 0x108; else -> (t + 0x108) shl (seg - 1) }
    (if (a and 0x80 != 0) t else -t).toShort()
  }
  private val U = ShortArray(256) { i ->
    val u = i.inv() and 0xff
    var t = ((u and 0x0f) shl 3) + 0x84
    t = t shl ((u and 0x70) shr 4)
    (if (u and 0x80 != 0) 0x84 - t else t - 0x84).toShort()
  }

  fun decodificar(b: ByteArray, de: Int, n: Int, leiA: Boolean, saida: ShortArray) {
    val tab = if (leiA) A else U
    for (k in 0 until n) saida[k] = tab[b[de + k].toInt() and 0xff]
  }
}
