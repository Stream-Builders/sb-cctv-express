// Cliente ONVIF mínimo (porte de src/controle/onvif.js do CCTV Express do computador): pergunta à câmera o endereço
// RTSP do vídeo principal e do secundário (o leve, para o mosaico). Autenticação WS-Security UsernameToken com senha em
// digest (o padrão ONVIF), com o desvio do relógio da câmera e, se ela pedir, HTTP Digest.
package builders.stream.cctvexpress.camera

import android.util.Base64
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class Onvif(private val ip: String, porta: Int, private val usuario: String, private val senha: String, canal: Int) {
  private val canal = maxOf(1, canal)
  private val dispositivo = "http://$ip:$porta/onvif/device_service"
  private var desvio = 0L

  class Enderecos(val principal: String, val secundario: String?)
  class Falha(val senhaErrada: Boolean, msg: String) : Exception(msg)

  private class Resposta(val status: Int, val corpo: String, val desafio: String)

  private fun esc(s: String) = s.replace(Regex("[<>&\"']")) { "&#${it.value[0].code};" }

  private fun post(url: String, xml: String, auth: String? = null, ms: Int = 5000): Resposta {
    val c = URL(url).openConnection() as HttpURLConnection
    try {
      c.requestMethod = "POST"
      c.connectTimeout = ms
      c.readTimeout = ms
      c.doOutput = true
      c.setRequestProperty("Content-Type", "application/soap+xml; charset=utf-8")
      if (auth != null) c.setRequestProperty("Authorization", auth)
      c.outputStream.use { it.write(xml.toByteArray(Charsets.UTF_8)) }
      val status = c.responseCode
      val corpo = (if (status >= 400) c.errorStream else c.inputStream)?.use { String(it.readBytes(), Charsets.UTF_8) } ?: ""
      return Resposta(status, corpo, c.getHeaderField("WWW-Authenticate") ?: "")
    } finally { c.disconnect() }
  }

  private fun cabecalhoSeguranca(): String {
    val nonce = ByteArray(16).also { SecureRandom().nextBytes(it) }
    val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
    val criado = fmt.format(Date(System.currentTimeMillis() + desvio))
    val sha = MessageDigest.getInstance("SHA-1").digest(nonce + criado.toByteArray() + senha.toByteArray())
    val b64 = { b: ByteArray -> Base64.encodeToString(b, Base64.NO_WRAP) }
    return "<s:Header><Security s:mustUnderstand=\"1\" xmlns=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd\"><UsernameToken><Username>${esc(usuario)}</Username><Password Type=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest\">${b64(sha)}</Password><Nonce EncodingType=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary\">${b64(nonce)}</Nonce><Created xmlns=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd\">$criado</Created></UsernameToken></Security></s:Header>"
  }

  private fun md5(s: String) = MessageDigest.getInstance("MD5").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

  /** HTTP Digest (RFC 7616, MD5, qop=auth), que o ONVIF Profile S também aceita. */
  private fun digestHttp(desafio: String, caminho: String): String {
    val p = Regex("(\\w+)=\"?([^\",]+)\"?").findAll(desafio).associate { it.groupValues[1].lowercase() to it.groupValues[2] }
    val cnonce = ByteArray(8).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    val nc = "00000001"
    val ha1 = md5("$usuario:${p["realm"]}:$senha")
    val ha2 = md5("POST:$caminho")
    val qop = if ((p["qop"] ?: "").contains("auth")) "auth" else ""
    val resp = if (qop.isNotEmpty()) md5("$ha1:${p["nonce"]}:$nc:$cnonce:$qop:$ha2") else md5("$ha1:${p["nonce"]}:$ha2")
    return "Digest username=\"$usuario\", realm=\"${p["realm"]}\", nonce=\"${p["nonce"]}\", uri=\"$caminho\", response=\"$resp\"" +
      (p["opaque"]?.let { ", opaque=\"$it\"" } ?: "") + (if (qop.isNotEmpty()) ", qop=$qop, nc=$nc, cnonce=\"$cnonce\"" else "")
  }

  private fun soap(url: String, corpo: String): String {
    val envelope = { cab: String -> "<?xml version=\"1.0\" encoding=\"UTF-8\"?><s:Envelope xmlns:s=\"http://www.w3.org/2003/05/soap-envelope\" xmlns:tt=\"http://www.onvif.org/ver10/schema\" xmlns:tds=\"http://www.onvif.org/ver10/device/wsdl\" xmlns:trt=\"http://www.onvif.org/ver10/media/wsdl\">$cab<s:Body>$corpo</s:Body></s:Envelope>" }
    var r = post(url, envelope(cabecalhoSeguranca()))
    if (r.status == 401 && r.desafio.contains("digest", true)) {
      val u = URI(url)
      r = post(url, envelope(""), digestHttp(r.desafio, (u.rawPath ?: "/") + (u.rawQuery?.let { "?$it" } ?: "")))
    }
    if (r.status >= 400) {
      val negado = r.status == 401 || r.corpo.contains("NotAuthorized") || r.corpo.contains("Sender")
      throw Falha(negado, "ONVIF ${r.status}")
    }
    return r.corpo
  }

  private fun tag(xml: String, nome: String): String? =
    Regex("<(?:\\w+:)?$nome[^>]*>([\\s\\S]*?)</(?:\\w+:)?$nome>").find(xml)?.groupValues?.get(1)

  /** Muita câmera informa um IP que não é o dela (o de fábrica): vale sempre o IP cadastrado, com a porta informada. */
  private fun noIpDaCamera(endereco: String?): String? {
    if (endereco.isNullOrBlank()) return null
    return try {
      val u = URI(endereco)
      val porta = if (u.port > 0) ":${u.port}" else ""
      "${u.scheme}://$ip$porta${u.rawPath ?: ""}${u.rawQuery?.let { "?$it" } ?: ""}"
    } catch (_: Exception) { endereco }
  }

  private fun lerDesvio() {
    try {
      val r = post(dispositivo, "<?xml version=\"1.0\" encoding=\"UTF-8\"?><s:Envelope xmlns:s=\"http://www.w3.org/2003/05/soap-envelope\"><s:Body><GetSystemDateAndTime xmlns=\"http://www.onvif.org/ver10/device/wsdl\"/></s:Body></s:Envelope>", ms = 4000)
      val utc = tag(r.corpo, "UTCDateTime") ?: return
      fun n(campo: String) = Regex("<(?:\\w+:)?$campo>(\\d+)<").find(utc)?.groupValues?.get(1)?.toInt()
      val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
        clear(); set(n("Year") ?: return, (n("Month") ?: return) - 1, n("Day") ?: return, n("Hour") ?: 0, n("Minute") ?: 0, n("Second") ?: 0)
      }
      desvio = cal.timeInMillis - System.currentTimeMillis()
    } catch (_: Exception) { desvio = 0 }
  }

  private fun uri(urlMidia: String, perfil: String): String? {
    val xml = soap(urlMidia, "<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup><trt:ProfileToken>${esc(perfil)}</trt:ProfileToken></trt:GetStreamUri>")
    return noIpDaCamera(tag(xml, "Uri")?.trim()?.replace("&amp;", "&"))
  }

  /** Os endereços RTSP do canal (lente) cadastrado: o principal e, se a câmera tiver, o secundário. */
  fun enderecos(): Enderecos {
    lerDesvio()
    val caps = soap(dispositivo, "<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>")
    val urlMidia = noIpDaCamera(tag(tag(caps, "Media") ?: "", "XAddr")?.trim()) ?: throw Falha(false, "sem serviço de mídia")
    val perfis = soap(urlMidia, "<trt:GetProfiles/>")
    // várias lentes: cada lente é uma fonte de vídeo (SourceToken) com os seus perfis; o canal N é a N-ésima fonte, e
    // dentro dela o primeiro perfil é o principal e o segundo o secundário
    val lista = Regex("<(?:\\w+:)?Profiles\\b[^>]*token=\"([^\"]+)\"[^>]*>([\\s\\S]*?)</(?:\\w+:)?Profiles>").findAll(perfis)
      .map { Pair(it.groupValues[1], tag(it.groupValues[2], "SourceToken")?.trim() ?: it.groupValues[1]) }.toList()
    if (lista.isEmpty()) throw Falha(false, "sem perfis")
    val fontes = lista.map { it.second }.distinct()
    val alvo = fontes.getOrNull(canal - 1) ?: fontes[0]
    val daLente = lista.filter { it.second == alvo }.map { it.first }
    val principal = uri(urlMidia, daLente[0]) ?: throw Falha(false, "sem endereço de vídeo")
    val secundario = daLente.getOrNull(1)?.let { try { uri(urlMidia, it) } catch (_: Exception) { null } }
    return Enderecos(principal.replace(Regex("^rtsp://[^@/]*@"), "rtsp://"), secundario?.replace(Regex("^rtsp://[^@/]*@"), "rtsp://"))
  }
}
