// O ao vivo pelo protocolo próprio da Xiongmai (DVRIP, porta 34567), o mesmo que o CCTV Express do computador usa
// (go2rtc, dvrip://). É o único caminho que escolhe a lente nas câmeras de duas lentes: o RTSP dessas câmeras ignora o
// canal e entrega sempre a primeira lente. Fluxo: login com o "hash Sofia" da senha, OPMonitor Claim e Start, e os
// quadros chegam na mesma conexão (H.264/H.265 já em Annex-B e G.711).
package builders.stream.cctvexpress.camera

import org.json.JSONObject
import java.io.DataInputStream
import java.io.IOException
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest

class FonteDvrip(
  private val ip: String,
  private val porta: Int,
  private val usuario: String,
  private val senha: String,
  /** canal da câmera a partir de 1 (no protocolo começa em 0) */
  private val canal: Int,
  /** vídeo principal ("Main") ou o secundário leve ("Extra1") */
  private val principal: Boolean,
  private val destino: Destino,
) : Fonte {

  class SenhaErrada : IOException("usuário ou senha")

  private companion object {
    const val LOGIN = 1000
    const val MANTER = 1006
    const val MONITOR = 1410
    const val MONITOR_DADOS = 1412
    const val MONITOR_PEDIR = 1413

    /** o "hash Sofia": MD5 dobrado em 8 caracteres alfanuméricos */
    fun sofia(s: String): String {
      val m = MessageDigest.getInstance("MD5").digest(s.toByteArray(Charsets.UTF_8))
      val a = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
      return (0 until 8).map { a[((m[2 * it].toInt() and 0xff) + (m[2 * it + 1].toInt() and 0xff)) % 62] }.joinToString("")
    }

    val TAXAS = mapOf(1 to 4000, 2 to 8000, 3 to 11025, 4 to 16000, 5 to 20000, 6 to 22050, 7 to 32000, 8 to 44100, 9 to 48000)
  }

  private val socket = Socket()
  @Volatile private var parado = false
  private lateinit var entrada: DataInputStream
  private lateinit var saida: OutputStream
  private var sessao = 0
  private var seq = 0

  override fun parar() {
    parado = true
    try { socket.close() } catch (_: Exception) {}
  }

  private fun idSessao() = "0x%08X".format(sessao)

  private fun enviar(cmd: Int, json: JSONObject) {
    val corpo = (json.toString() + "\n\u0000").toByteArray(Charsets.UTF_8)
    val c = ByteArray(20)
    c[0] = 0xff.toByte()
    escrever32(c, 4, sessao)
    escrever32(c, 8, seq++)
    c[14] = (cmd and 0xff).toByte(); c[15] = (cmd shr 8).toByte()
    escrever32(c, 16, corpo.size)
    synchronized(this) { saida.write(c + corpo); saida.flush() }
  }

  private fun escrever32(b: ByteArray, i: Int, v: Int) {
    b[i] = v.toByte(); b[i + 1] = (v shr 8).toByte(); b[i + 2] = (v shr 16).toByte(); b[i + 3] = (v shr 24).toByte()
  }

  private fun le32(b: ByteArray, i: Int) =
    (b[i].toInt() and 0xff) or ((b[i + 1].toInt() and 0xff) shl 8) or ((b[i + 2].toInt() and 0xff) shl 16) or ((b[i + 3].toInt() and 0xff) shl 24)

  private class Pacote(val cmd: Int, val sessao: Int, val corpo: ByteArray) {
    fun json(): JSONObject = try { JSONObject(String(corpo, Charsets.UTF_8).trimEnd('\u0000', '\n', '\r')) } catch (_: Exception) { JSONObject() }
  }

  private val cab = ByteArray(20)

  private fun ler(): Pacote {
    entrada.readFully(cab)
    if (cab[0] != 0xff.toByte()) throw IOException("cabeçalho DVRIP")
    val tam = le32(cab, 16)
    if (tam < 0 || tam > 8 * 1024 * 1024) throw IOException("pacote DVRIP")
    val corpo = ByteArray(tam)
    entrada.readFully(corpo)
    return Pacote((cab[14].toInt() and 0xff) or ((cab[15].toInt() and 0xff) shl 8), le32(cab, 4), corpo)
  }

  private fun monitor(acao: String) = JSONObject().put("Name", "OPMonitor").put("SessionID", idSessao()).put(
    "OPMonitor", JSONObject().put("Action", acao).put("Parameter", JSONObject()
      .put("Channel", canal - 1).put("CombinMode", "NONE").put("StreamType", if (principal) "Main" else "Extra1").put("TransMode", "TCP")),
  )

  private var intervalo = 10_000L

  /** conecta e entra com o usuário e a senha (SenhaErrada se a câmera recusar) */
  private fun entrar() {
    socket.connect(InetSocketAddress(ip, porta), 6000)
    socket.soTimeout = 10_000
    socket.tcpNoDelay = true
    entrada = DataInputStream(java.io.BufferedInputStream(socket.getInputStream(), 256 * 1024))
    saida = socket.getOutputStream()
    enviar(LOGIN, JSONObject().put("EncryptType", "MD5").put("LoginType", "DVRIP-Web").put("PassWord", sofia(senha)).put("UserName", usuario))
    val login = ler()
    val r = login.json()
    when (r.optInt("Ret")) {
      100 -> {}
      203, 205 -> throw SenhaErrada()
      else -> throw IOException("login DVRIP ${r.optInt("Ret")}")
    }
    sessao = login.sessao.takeIf { it != 0 } ?: r.optString("SessionID").removePrefix("0x").toLongOrNull(16)?.toInt() ?: 0
    intervalo = (r.optInt("AliveInterval", 20).coerceIn(5, 60) * 1000L) / 2
  }

  /** só confere o login (ao salvar a câmera): SenhaErrada, IOException (porta fechada) ou nada */
  fun testar() {
    try { entrar() } finally { parar() }
  }

  override fun rodar() {
    entrar()
    enviar(MONITOR_PEDIR, monitor("Claim"))
    var resp = ler()
    while (resp.cmd == MONITOR_DADOS) resp = ler()
    if (resp.json().optInt("Ret", 100) != 100) throw IOException("OPMonitor ${resp.json().optInt("Ret")}")
    enviar(MONITOR, monitor("Start"))

    var ultimoManter = System.currentTimeMillis()
    while (!parado) {
      val p = ler()
      if (p.cmd == MONITOR_DADOS) midia(p.corpo)
      val agora = System.currentTimeMillis()
      if (agora - ultimoManter > intervalo) {
        ultimoManter = agora
        enviar(MANTER, JSONObject().put("Name", "KeepAlive").put("SessionID", idSessao()))
      }
    }
  }

  // ---------- os quadros (vêm picados em vários pacotes DVRIP: junta e corta pelo cabeçalho de cada quadro) ----------

  private var buf = ByteArray(1024 * 1024)
  private var tam = 0
  private var mime: String? = null
  private var pcm = ShortArray(2048)

  private fun midia(b: ByteArray) {
    if (tam + b.size > buf.size) buf = buf.copyOf(maxOf(buf.size * 2, tam + b.size))
    System.arraycopy(b, 0, buf, tam, b.size)
    tam += b.size
    var i = 0
    while (tam - i >= 8) {
      if (buf[i].toInt() != 0 || buf[i + 1].toInt() != 0 || buf[i + 2].toInt() != 1) { i = ressincronizar(i + 1); continue }
      val tipo = buf[i + 3].toInt() and 0xff
      val cabecalho: Int
      val n: Int
      when (tipo) {
        0xFC, 0xFE -> { if (tam - i < 16) break; cabecalho = 16; n = le32(buf, i + 12) }
        0xFD -> { cabecalho = 8; n = le32(buf, i + 4) }
        0xFA, 0xF9 -> { cabecalho = 8; n = (buf[i + 6].toInt() and 0xff) or ((buf[i + 7].toInt() and 0xff) shl 8) }
        else -> { i = ressincronizar(i + 1); continue }
      }
      if (n < 0 || n > 8 * 1024 * 1024) { i = ressincronizar(i + 1); continue }
      if (tam - i < cabecalho + n) break
      val ini = i + cabecalho
      when (tipo) {
        0xFC, 0xFE -> {
          val q = buf.copyOfRange(ini, ini + n)
          val m = Nal.mimeDe(q) ?: when (buf[i + 4].toInt()) { 3 -> Nal.HEVC; else -> Nal.AVC }
          mime = m
          destino.video(m, q, true)
        }
        0xFD -> mime?.let { destino.video(it, buf.copyOfRange(ini, ini + n), false) }
        0xFA -> if (destino.comSom) {
          val codec = buf[i + 4].toInt() and 0xff
          // 0x0E = G.711 lei A, 0x0A = G.711 lei µ (os outros formatos ficam sem som)
          if (codec == 0x0E || codec == 0x0A) {
            if (pcm.size < n) pcm = ShortArray(n)
            G711.decodificar(buf, ini, n, codec == 0x0E, pcm)
            destino.pcm(pcm, n, TAXAS[buf[i + 5].toInt() and 0xff] ?: 8000, 1)
          }
        }
      }
      i += cabecalho + n
    }
    if (i > 0) { System.arraycopy(buf, i, buf, 0, tam - i); tam -= i }
  }

  /** perdeu o alinhamento: procura o próximo 00 00 01 Fx */
  private fun ressincronizar(de: Int): Int {
    var k = de
    while (k + 4 <= tam) {
      if (buf[k].toInt() == 0 && buf[k + 1].toInt() == 0 && buf[k + 2].toInt() == 1 && (buf[k + 3].toInt() and 0xff) in 0xF9..0xFE) return k
      k++
    }
    return maxOf(de, tam - 3)
  }
}
