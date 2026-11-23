// Cliente RTSP do ao vivo (RFC 2326), com o RTP dentro da própria conexão (TCP intercalado): passa por qualquer Wi-Fi,
// sem portas UDP e sem perda de pacote. Entende H.264 e H.265 (RFC 6184 e 7798), AAC (RFC 3640) e G.711, com
// autenticação Basic e Digest (MD5 ou SHA-256). Feito para as câmeras que fogem do padrão: parâmetros do vídeo com
// código de início dentro do SDP, G.711 a 16 kHz, câmera que não manda RTP-Info, celular-câmera do próprio app.
package builders.stream.cctvexpress.camera

import android.util.Base64
import java.io.BufferedInputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom

class FonteRtsp(endereco: String, private val destino: Destino, private val comAudio: Boolean) : Fonte {

  class SenhaErrada : IOException("usuário ou senha")

  private val host: String
  private val porta: Int
  private val usuario: String
  private val senha: String
  private val url: String

  init {
    val m = Regex("^rtsp://(?:([^:@/]*)(?::([^@/]*))?@)?([^:/?#]+)(?::(\\d+))?(.*)$", RegexOption.IGNORE_CASE).find(endereco.trim())
      ?: throw IOException("endereço")
    fun dec(s: String) = URLDecoder.decode(s.replace("+", "%2B"), "UTF-8")
    usuario = dec(m.groupValues[1])
    senha = dec(m.groupValues[2])
    host = m.groupValues[3]
    porta = m.groupValues[4].toIntOrNull() ?: 554
    url = "rtsp://$host:$porta${m.groupValues[5].ifEmpty { "/" }}"
  }

  private val socket = Socket()
  @Volatile private var parado = false
  private lateinit var entrada: InputStream
  private lateinit var saida: OutputStream
  private var cseq = 1
  private var sessao: String? = null
  private var desafio: String? = null
  private var nc = 0

  /** uma trilha do SDP */
  private class Trilha(val midia: String, val pt: Int) {
    var codec = ""
    var relogio = 0
    var canais = 1
    var controle: String? = null
    val fmtp = HashMap<String, String>()
    var canal = -1
  }

  private val trilhas = ArrayList<Trilha>()
  private var video: Trilha? = null
  private var audio: Trilha? = null

  override fun parar() {
    parado = true
    try { socket.close() } catch (_: Exception) {}
  }

  override fun rodar() {
    socket.connect(InetSocketAddress(host, porta), 6000)
    // sem nada da câmera por 10 s: a conexão morreu (a fonte cai e o quadro reconecta)
    socket.soTimeout = 10_000
    socket.tcpNoDelay = true
    entrada = BufferedInputStream(socket.getInputStream(), 256 * 1024)
    saida = socket.getOutputStream()

    val d = pedirComSenha("DESCRIBE", url, "Accept: application/sdp\r\n")
    if (d.status != 200) throw IOException("DESCRIBE ${d.status}")
    val base = d.cabecalho("Content-Base") ?: d.cabecalho("Content-Location") ?: url
    lerSdp(d.corpo)
    val v = trilhas.firstOrNull { it.midia == "video" && (it.codec == "H264" || it.codec == "H265") }
      ?: throw IOException("vídeo sem H.264/H.265")
    video = v
    audio = if (comAudio) trilhas.firstOrNull { it.midia == "audio" && it.codec in listOf("PCMA", "PCMU", "MPEG4-GENERIC") } else null
    var canal = 0
    for (t in listOfNotNull(v, audio)) {
      val c = t.controle
      val alvo = when {
        c == null || c == "*" -> base
        c.startsWith("rtsp://", true) -> c
        else -> base.trimEnd('/') + "/" + c
      }
      t.canal = canal
      val r = pedirComSenha("SETUP", alvo, "Transport: RTP/AVP/TCP;unicast;interleaved=$canal-${canal + 1}\r\n")
      if (r.status != 200) {
        if (t === v) throw IOException("SETUP ${r.status}")
        audio = null
        continue
      }
      // a câmera pode escolher outros canais
      Regex("interleaved=(\\d+)").find(r.cabecalho("Transport") ?: "")?.groupValues?.get(1)?.toIntOrNull()?.let { t.canal = it }
      if (sessao == null) sessao = r.cabecalho("Session")?.substringBefore(';')?.trim()
      canal += 2
    }
    val p = pedirComSenha("PLAY", base, "Range: npt=0.000-\r\n")
    if (p.status != 200) throw IOException("PLAY ${p.status}")
    val tempoSessao = Regex("timeout=(\\d+)").find(p.cabecalho("Session") ?: "")?.groupValues?.get(1)?.toIntOrNull() ?: 60
    val manter = maxOf(5_000L, minOf(25_000L, tempoSessao * 1000L / 2))
    var ultimoManter = System.currentTimeMillis()

    // o ao vivo
    while (!parado) {
      val b = entrada.read()
      if (b < 0) throw EOFException()
      if (b == '$'.code) {
        val ch = lerByte()
        val n = (lerByte() shl 8) or lerByte()
        val pacote = ByteArray(n)
        lerTudo(pacote)
        rtp(ch, pacote)
      } else {
        // uma resposta RTSP no meio (a do OPTIONS que mantém a sessão viva): lê e descarta
        lerResposta(b)
      }
      val agora = System.currentTimeMillis()
      if (agora - ultimoManter > manter) {
        ultimoManter = agora
        enviar("OPTIONS", base, "")
      }
    }
  }

  // ---------- RTSP ----------

  private class Resposta(val status: Int, val linhas: List<String>, val corpo: String) {
    fun cabecalho(nome: String) = linhas.firstOrNull { it.startsWith("$nome:", true) }?.substringAfter(':')?.trim()
    fun todos(nome: String) = linhas.filter { it.startsWith("$nome:", true) }.map { it.substringAfter(':').trim() }
  }

  private fun lerByte(): Int { val b = entrada.read(); if (b < 0) throw EOFException(); return b }

  private fun lerTudo(a: ByteArray) {
    var k = 0
    while (k < a.size) { val n = entrada.read(a, k, a.size - k); if (n < 0) throw EOFException(); k += n }
  }

  private fun lerLinha(primeiro: Int = -1): String {
    val sb = StringBuilder()
    if (primeiro >= 0) sb.append(primeiro.toChar())
    while (true) {
      val b = lerByte()
      if (b == '\n'.code) break
      if (b != '\r'.code) sb.append(b.toChar())
      if (sb.length > 8192) throw IOException("linha longa")
    }
    return sb.toString()
  }

  private fun lerResposta(primeiro: Int = -1): Resposta {
    val status = lerLinha(primeiro)
    val linhas = ArrayList<String>()
    while (true) { val l = lerLinha(); if (l.isEmpty()) break; linhas += l }
    val tam = linhas.firstOrNull { it.startsWith("Content-Length:", true) }?.substringAfter(':')?.trim()?.toIntOrNull() ?: 0
    val corpo = ByteArray(tam).also { lerTudo(it) }
    return Resposta(Regex("^RTSP/\\d\\.\\d (\\d+)").find(status)?.groupValues?.get(1)?.toInt() ?: 0, linhas, String(corpo, Charsets.UTF_8))
  }

  private fun enviar(metodo: String, uri: String, extra: String) {
    val sb = StringBuilder("$metodo $uri RTSP/1.0\r\nCSeq: ${cseq++}\r\nUser-Agent: CCTV Express\r\n")
    autorizacao(metodo, uri)?.let { sb.append("Authorization: ").append(it).append("\r\n") }
    sessao?.let { sb.append("Session: ").append(it).append("\r\n") }
    sb.append(extra).append("\r\n")
    saida.write(sb.toString().toByteArray(Charsets.UTF_8))
    saida.flush()
  }

  /** um pedido e a resposta dele (antes do PLAY não há RTP no meio; se houver, é descartado) */
  private fun pedir(metodo: String, uri: String, extra: String): Resposta {
    enviar(metodo, uri, extra)
    while (true) {
      val b = lerByte()
      if (b == '$'.code) { lerByte(); val n = (lerByte() shl 8) or lerByte(); lerTudo(ByteArray(n)); continue }
      return lerResposta(b)
    }
  }

  private fun pedirComSenha(metodo: String, uri: String, extra: String): Resposta {
    var r = pedir(metodo, uri, extra)
    if (r.status == 401) {
      val ds = r.todos("WWW-Authenticate")
      // Digest com SHA-256 quando a câmera oferece, senão Digest MD5, senão Basic
      desafio = ds.firstOrNull { it.startsWith("Digest", true) && Regex("algorithm=\"?SHA-256", RegexOption.IGNORE_CASE).containsMatchIn(it) }
        ?: ds.firstOrNull { it.startsWith("Digest", true) } ?: ds.firstOrNull()
      if (desafio == null) throw SenhaErrada()
      r = pedir(metodo, uri, extra)
      if (r.status == 401) throw SenhaErrada()
    }
    return r
  }

  private fun hash(algoritmo: String, s: String) =
    MessageDigest.getInstance(if (algoritmo.startsWith("SHA-256", true)) "SHA-256" else "MD5").digest(s.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }

  private fun autorizacao(metodo: String, uri: String): String? {
    val d = desafio ?: return null
    if (d.startsWith("Basic", true)) {
      return "Basic " + Base64.encodeToString("$usuario:$senha".toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
    }
    val p = Regex("(\\w+)=(?:\"([^\"]*)\"|([^,\\s]+))").findAll(d).associate { it.groupValues[1].lowercase() to it.groupValues[2].ifEmpty { it.groupValues[3] } }
    val alg = p["algorithm"] ?: "MD5"
    val realm = p["realm"] ?: ""
    val nonce = p["nonce"] ?: ""
    val ha1 = hash(alg, "$usuario:$realm:$senha")
    val ha2 = hash(alg, "$metodo:$uri")
    val qop = p["qop"]?.split(',')?.map { it.trim() }?.firstOrNull { it == "auth" }
    val sb = StringBuilder("Digest username=\"$usuario\", realm=\"$realm\", nonce=\"$nonce\", uri=\"$uri\"")
    if (qop != null) {
      val n = "%08x".format(++nc)
      val cnonce = ByteArray(8).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
      sb.append(", response=\"${hash(alg, "$ha1:$nonce:$n:$cnonce:$qop:$ha2")}\", qop=$qop, nc=$n, cnonce=\"$cnonce\"")
    } else {
      sb.append(", response=\"${hash(alg, "$ha1:$nonce:$ha2")}\"")
    }
    if (p.containsKey("algorithm")) sb.append(", algorithm=$alg")
    p["opaque"]?.let { sb.append(", opaque=\"$it\"") }
    return sb.toString()
  }

  // ---------- SDP ----------

  private fun lerSdp(sdp: String) {
    var atual: Trilha? = null
    for (l in sdp.lines().map { it.trim() }) {
      if (l.startsWith("m=")) {
        val partes = l.substring(2).split(' ')
        atual = Trilha(partes[0], partes.getOrNull(3)?.toIntOrNull() ?: -1).also { trilhas += it }
        when (atual.pt) { 0 -> { atual.codec = "PCMU"; atual.relogio = 8000 }; 8 -> { atual.codec = "PCMA"; atual.relogio = 8000 } }
        continue
      }
      val t = atual ?: continue
      Regex("^a=rtpmap:\\d+ ([^/]+)/(\\d+)(?:/(\\d+))?").find(l)?.let {
        t.codec = it.groupValues[1].uppercase(); t.relogio = it.groupValues[2].toInt(); t.canais = it.groupValues[3].toIntOrNull() ?: 1
      }
      Regex("^a=fmtp:\\d+ (.*)").find(l)?.let { m ->
        for (par in m.groupValues[1].split(';')) {
          val k = par.indexOf('=')
          if (k > 0) t.fmtp[par.substring(0, k).trim().lowercase()] = par.substring(k + 1).trim()
        }
      }
      Regex("^a=control:(\\S+)").find(l)?.let { t.controle = it.groupValues[1] }
    }
  }

  /** os conjuntos de parâmetros do SDP, sem código de início (algumas câmeras põem 00 00 00 01 dentro do base64) */
  private fun parametrosDoSdp(t: Trilha): ByteArray {
    val partes = if (t.codec == "H265") listOf("sprop-vps", "sprop-sps", "sprop-pps").mapNotNull { t.fmtp[it] }
    else t.fmtp["sprop-parameter-sets"]?.split(',') ?: emptyList()
    var r = ByteArray(0)
    for (p in partes) {
      val b = try { Base64.decode(p.trim(), Base64.DEFAULT) } catch (_: Exception) { continue }
      val nals = Nal.separar(b)
      if (nals.isEmpty()) r += Nal.INICIO + b else for ((de, ate) in nals) r += Nal.INICIO + b.copyOfRange(de, ate)
    }
    return r
  }

  // ---------- RTP ----------

  private val quadro = java.io.ByteArrayOutputStream(512 * 1024)
  private var tsQuadro = -1L
  private var fu: java.io.ByteArrayOutputStream? = null
  private var parametros: ByteArray? = null
  private var pcm = ShortArray(4096)

  private fun rtp(canal: Int, p: ByteArray) {
    val t = when (canal) { video?.canal -> video; audio?.canal -> audio; else -> null } ?: return
    if (p.size < 12 || (p[0].toInt() and 0xc0) != 0x80) return
    val cc = p[0].toInt() and 0x0f
    var ini = 12 + cc * 4
    if (p[0].toInt() and 0x10 != 0) {
      if (p.size < ini + 4) return
      ini += 4 + (((p[ini + 2].toInt() and 0xff) shl 8) or (p[ini + 3].toInt() and 0xff)) * 4
    }
    var fim = p.size
    if (p[0].toInt() and 0x20 != 0) fim -= p[p.size - 1].toInt() and 0xff
    if (ini >= fim) return
    val marca = p[1].toInt() and 0x80 != 0
    val ts = ((p[4].toLong() and 0xff) shl 24) or ((p[5].toLong() and 0xff) shl 16) or ((p[6].toLong() and 0xff) shl 8) or (p[7].toLong() and 0xff)
    if (t === audio) { if (destino.comSom) audioRtp(t, p, ini, fim); return }

    if (tsQuadro >= 0 && ts != tsQuadro) fecharQuadro(t)
    tsQuadro = ts
    if (t.codec == "H264") {
      when (p[ini].toInt() and 0x1f) {
        in 1..23 -> { quadro.write(Nal.INICIO); quadro.write(p, ini, fim - ini) }
        24 -> agregado(p, ini + 1, fim)
        28 -> if (ini + 2 <= fim) {
          val f = p[ini + 1].toInt()
          if (f and 0x80 != 0) fu = java.io.ByteArrayOutputStream().apply { write((p[ini].toInt() and 0xe0) or (f and 0x1f)) }
          fu?.write(p, ini + 2, fim - ini - 2)
          if (f and 0x40 != 0) fu?.let { quadro.write(Nal.INICIO); it.writeTo(quadro); fu = null }
        }
        else -> {}
      }
    } else {
      when ((p[ini].toInt() shr 1) and 0x3f) {
        48 -> agregado(p, ini + 2, fim)
        49 -> if (ini + 3 <= fim) {
          val f = p[ini + 2].toInt()
          if (f and 0x80 != 0) fu = java.io.ByteArrayOutputStream().apply { write((p[ini].toInt() and 0x81) or ((f and 0x3f) shl 1)); write(p[ini + 1].toInt()) }
          fu?.write(p, ini + 3, fim - ini - 3)
          if (f and 0x40 != 0) fu?.let { quadro.write(Nal.INICIO); it.writeTo(quadro); fu = null }
        }
        else -> { quadro.write(Nal.INICIO); quadro.write(p, ini, fim - ini) }
      }
    }
    if (marca) { fecharQuadro(t); tsQuadro = -1 }
  }

  /** STAP-A (H.264) e AP (H.265): várias NALs num pacote, cada uma com o tamanho em 2 bytes */
  private fun agregado(p: ByteArray, de: Int, fim: Int) {
    var i = de
    while (i + 2 <= fim) {
      val n = ((p[i].toInt() and 0xff) shl 8) or (p[i + 1].toInt() and 0xff)
      i += 2
      if (n == 0 || i + n > fim) break
      quadro.write(Nal.INICIO)
      quadro.write(p, i, n)
      i += n
    }
  }

  private fun fecharQuadro(t: Trilha) {
    if (quadro.size() == 0) return
    var dado = quadro.toByteArray()
    quadro.reset()
    val mime = if (t.codec == "H265") Nal.HEVC else Nal.AVC
    var chave = false
    var temParametros = false
    for ((de, _) in Nal.separar(dado)) {
      val tipo = Nal.tipo(mime, dado[de])
      if (Nal.eChave(mime, tipo)) chave = true
      if (Nal.eParametro(mime, tipo)) temParametros = true
    }
    if (chave) {
      if (temParametros) {
        // guarda os parâmetros que vêm no próprio vídeo (valem mais que os do SDP)
        val ps = Nal.separar(dado).filter { Nal.eParametro(mime, Nal.tipo(mime, dado[it.first])) }
        parametros = ps.fold(ByteArray(0)) { a, (de, ate) -> a + Nal.INICIO + dado.copyOfRange(de, ate) }
      } else {
        val ps = parametros ?: parametrosDoSdp(t).also { parametros = it }
        dado = ps + dado
      }
    }
    destino.video(mime, dado, chave)
  }

  private fun audioRtp(t: Trilha, p: ByteArray, ini: Int, fim: Int) {
    when (t.codec) {
      "PCMA", "PCMU" -> {
        val n = fim - ini
        if (pcm.size < n) pcm = ShortArray(n)
        G711.decodificar(p, ini, n, t.codec == "PCMA", pcm)
        destino.pcm(pcm, n, if (t.relogio > 0) t.relogio else 8000, t.canais)
      }
      "MPEG4-GENERIC" -> {
        // RFC 3640 (AAC-hbr): cabeçalhos de AU (tamanho em bits nos 2 primeiros bytes) e depois as AUs
        val config = t.fmtp["config"]?.let { h -> ByteArray(h.length / 2) { h.substring(it * 2, it * 2 + 2).toInt(16).toByte() } } ?: return
        val tamBits = t.fmtp["sizelength"]?.toIntOrNull() ?: 13
        val idxBits = t.fmtp["indexlength"]?.toIntOrNull() ?: 3
        if (fim - ini < 2) return
        val bitsCab = ((p[ini].toInt() and 0xff) shl 8) or (p[ini + 1].toInt() and 0xff)
        val bytesCab = (bitsCab + 7) / 8
        var dados = ini + 2 + bytesCab
        val porAu = tamBits + idxBits
        var bit = 0
        while (bit + porAu <= bitsCab && dados < fim) {
          var tam = 0
          for (k in 0 until tamBits) {
            val pos = bit + k
            val byte = p[ini + 2 + pos / 8].toInt() and 0xff
            tam = (tam shl 1) or ((byte shr (7 - pos % 8)) and 1)
          }
          bit += porAu
          if (dados + tam > fim) break
          destino.aac(p.copyOfRange(dados, dados + tam), if (t.relogio > 0) t.relogio else 8000, t.canais, config)
          dados += tam
        }
      }
    }
  }
}

/** Uma origem de vídeo ao vivo: roda até cair (exceção) ou até alguém chamar parar(). */
interface Fonte {
  fun rodar()
  fun parar()
}
