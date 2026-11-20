// Sonda RTSP (porte de src/controle/rtsp.js do CCTV Express do computador): descobre o caminho do vídeo de uma câmera
// quando a pessoa só sabe o IP. Manda DESCRIBE (Basic ou Digest, o que a câmera pedir) nos caminhos que as marcas usam
// e fica com o primeiro que devolve 200 com vídeo. Não abre o vídeo: só lê a descrição da sessão (SDP).
package builders.stream.cctvexpress.camera

import java.net.InetSocketAddress
import java.net.Socket
import java.net.URLEncoder
import java.security.MessageDigest

object SondaRtsp {
  // caminhos de fábrica, do mais usado para o menos usado; {u}/{s} = usuário e senha, {c} = canal
  val CAMINHOS = listOf(
    "/user={u}&password={s}&channel={c}&stream=0.sdp?", // Xiongmai (XMEye, iCSee, NetSurveillance)
    "/cam/realmonitor?channel={c}&subtype=0", // Dahua, Intelbras, Imou, Amcrest
    "/Streaming/Channels/{c}01", // Hikvision, HiLook, EZVIZ
    "/h264Preview_0{c}_main", // Reolink
    "/stream1", // TP-Link Tapo e VIGI
    "/unicast/c{c}/s0/live", // Uniview
    "/media/video{c}", // Uniview (firmware antigo)
    "/onvif1", // Yoosee
    "/ch0_0.264", // V380
    "/live/ch00_0", // genéricas (HiSilicon)
    "/11", // genéricas
    "/live", // celular (apps de câmera) e genéricas
    "/",
  )

  private class Resposta(val status: Int, val desafio: String, val sdp: String)

  private fun md5(s: String) = MessageDigest.getInstance("MD5").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

  private fun autorizacao(desafio: String, usuario: String, senha: String, url: String): String {
    if (desafio.startsWith("basic", true)) {
      return "Basic " + android.util.Base64.encodeToString("$usuario:$senha".toByteArray(), android.util.Base64.NO_WRAP)
    }
    val p = Regex("(\\w+)=\"([^\"]*)\"").findAll(desafio).associate { it.groupValues[1].lowercase() to it.groupValues[2] }
    val resposta = md5("${md5("$usuario:${p["realm"]}:$senha")}:${p["nonce"]}:${md5("DESCRIBE:$url")}")
    return "Digest username=\"$usuario\", realm=\"${p["realm"]}\", nonce=\"${p["nonce"]}\", uri=\"$url\", response=\"$resposta\""
  }

  private fun describe(ip: String, porta: Int, url: String, auth: String?, ms: Int = 4000): Resposta {
    try {
      Socket().use { s ->
        s.connect(InetSocketAddress(ip, porta), ms)
        s.soTimeout = ms
        val pedido = "DESCRIBE $url RTSP/1.0\r\nCSeq: 2\r\nAccept: application/sdp\r\nUser-Agent: CCTV Express\r\n" +
          (if (auth != null) "Authorization: $auth\r\n" else "") + "\r\n"
        s.getOutputStream().write(pedido.toByteArray())
        val entrada = s.getInputStream()
        val buf = StringBuilder()
        val bloco = ByteArray(4096)
        while (true) {
          val n = try { entrada.read(bloco) } catch (_: Exception) { -1 }
          if (n <= 0) break
          buf.append(String(bloco, 0, n, Charsets.ISO_8859_1))
          val fimCab = buf.indexOf("\r\n\r\n")
          if (fimCab < 0) continue
          val status = Regex("^RTSP/1\\.0 (\\d+)").find(buf)?.groupValues?.get(1)?.toInt() ?: 0
          val tam = Regex("Content-Length:\\s*(\\d+)", RegexOption.IGNORE_CASE).find(buf)?.groupValues?.get(1)?.toInt() ?: 0
          if (status == 200 && buf.length < fimCab + 4 + tam) continue
          val cab = buf.substring(0, fimCab)
          val desafios = Regex("WWW-Authenticate:\\s*(.+)", RegexOption.IGNORE_CASE).findAll(cab).map { it.groupValues[1].trim() }.toList()
          return Resposta(status, desafios.firstOrNull { it.startsWith("digest", true) } ?: desafios.firstOrNull() ?: "", buf.substring(fimCab + 4))
        }
        return Resposta(0, "", "")
      }
    } catch (_: Exception) { return Resposta(0, "", "") }
  }

  /** DESCRIBE autenticado: devolve o status e se o caminho tem vídeo. */
  fun temVideo(ip: String, porta: Int, caminho: String, usuario: String, senha: String): Pair<Boolean, Int> {
    val url = "rtsp://$ip:$porta$caminho"
    var r = describe(ip, porta, url, null)
    if (r.status == 401 && r.desafio.isNotEmpty()) r = describe(ip, porta, url, autorizacao(r.desafio, usuario, senha, url))
    return Pair(r.status == 200 && r.sdp.contains("m=video", true), r.status)
  }

  class Resultado(val url: String?, val erro: String?)

  private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

  /** Acha o endereço RTSP da câmera (sem a senha) ou o motivo de não achar. Para no primeiro que funciona. */
  fun descobrir(ip: String, porta: Int?, usuario: String, senha: String, canal: Int): Resultado {
    val portas = linkedSetOf(porta ?: 554, 554, 8554, 10554)
    var negado = false
    for (p in portas) {
      // porta fechada: nem tenta os caminhos
      if (describe(ip, p, "rtsp://$ip:$p/", null, 2500).status == 0) continue
      for (molde in CAMINHOS) {
        val caminho = molde.replace("{u}", enc(usuario)).replace("{s}", enc(senha)).replace("{c}", canal.toString())
        val (ok, status) = temVideo(ip, p, caminho, usuario, senha)
        if (ok) {
          // o caminho Xiongmai leva a senha na própria URL: guarda sem ela (o app põe na hora de conectar)
          val salvo = if (molde.contains("{s}")) molde.replace("{u}", enc(usuario)).replace("{s}", "").replace("{c}", canal.toString()) else caminho
          return Resultado("rtsp://$ip:$p$salvo", null)
        }
        if (status == 401) negado = true
      }
    }
    return Resultado(null, if (negado) "senha" else "caminho")
  }
}
