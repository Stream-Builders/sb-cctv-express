// Detecta câmeras na rede do celular (porte de src/descoberta.js do CCTV Express do computador), de dois jeitos ao
// mesmo tempo: ONVIF WS-Discovery por multicast e varredura das portas típicas de câmera na sub-rede /24 do Wi-Fi. Só
// abre e fecha a conexão TCP: não envia senha nem dado nenhum.
package builders.stream.cctvexpress.camera

import android.content.Context
import android.net.wifi.WifiManager
import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object Descoberta {
  // 8555: o canal de controle do CCTV Express Câmera (outro celular servindo de câmera)
  private val PORTAS = listOf(34567, 554, 8554, 10554, 80, 8899, 37777, 8000, 8555)

  /** Os IPv4 deste celular nas redes locais (Wi-Fi, cabo, roteador do próprio celular). */
  fun meusIps(): List<String> = try {
    NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
      .flatMap { it.inetAddresses.toList() }.filterIsInstance<Inet4Address>()
      .map { it.hostAddress ?: "" }.filter { it.isNotEmpty() && !it.startsWith("169.254.") }
  } catch (_: Exception) { emptyList() }

  private fun portaAberta(ip: String, porta: Int, ms: Int = 400) = try {
    Socket().use { it.connect(InetSocketAddress(ip, porta), ms); true }
  } catch (_: Exception) { false }

  private fun varrer(): Map<String, Set<Int>> {
    val meus = meusIps()
    val bases = meus.map { it.substringBeforeLast('.') }.distinct()
    val achados = ConcurrentHashMap<String, MutableSet<Int>>()
    val pool = Executors.newFixedThreadPool(96)
    for (base in bases) for (h in 1..254) {
      val ip = "$base.$h"
      if (ip in meus) continue
      for (p in PORTAS) pool.execute { if (portaAberta(ip, p)) achados.getOrPut(ip) { ConcurrentHashMap.newKeySet() }.add(p) }
    }
    pool.shutdown()
    pool.awaitTermination(60, TimeUnit.SECONDS)
    return achados
  }

  private fun onvif(contexto: Context, ms: Long = 3000): Map<String, Int> {
    val achados = ConcurrentHashMap<String, Int>()
    // sem a trava de multicast o Wi-Fi do Android descarta as respostas
    val wifi = contexto.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    val trava = wifi.createMulticastLock("cctv-express-busca").apply { setReferenceCounted(false) }
    try {
      trava.acquire()
      MulticastSocket(null).use { s ->
        s.reuseAddress = true
        s.bind(InetSocketAddress(0))
        s.soTimeout = 300
        val sonda = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><e:Envelope xmlns:e=\"http://www.w3.org/2003/05/soap-envelope\" xmlns:w=\"http://schemas.xmlsoap.org/ws/2004/08/addressing\" xmlns:d=\"http://schemas.xmlsoap.org/ws/2005/04/discovery\" xmlns:dn=\"http://www.onvif.org/ver10/network/wsdl\"><e:Header><w:MessageID>uuid:${UUID.randomUUID()}</w:MessageID><w:To e:mustUnderstand=\"true\">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand=\"true\">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>".toByteArray()
        val grupo = InetAddress.getByName("239.255.255.250")
        val enviar = { try { s.send(DatagramPacket(sonda, sonda.size, grupo, 3702)) } catch (_: Exception) {} }
        enviar()
        val fim = System.currentTimeMillis() + ms
        var reenviado = false
        val buf = ByteArray(16 * 1024)
        while (System.currentTimeMillis() < fim) {
          // UDP perde: a sonda sai de novo depois de 600 ms
          if (!reenviado && System.currentTimeMillis() > fim - ms + 600) { enviar(); reenviado = true }
          val pacote = DatagramPacket(buf, buf.size)
          try { s.receive(pacote) } catch (_: SocketTimeoutException) { continue }
          val texto = String(pacote.data, 0, pacote.length)
          val porta = Regex("XAddrs>\\s*https?://[^/:\\s]+:(\\d+)").find(texto)?.groupValues?.get(1)?.toIntOrNull()
          pacote.address?.hostAddress?.let { achados[it] = porta ?: 80 }
        }
      }
    } catch (_: Exception) { /* rede sem multicast: fica a varredura */ } finally { try { trava.release() } catch (_: Exception) {} }
    return achados
  }

  /** Lista dos aparelhos achados, com o tipo sugerido para o cadastro (o mesmo formato do computador). */
  fun detectar(contexto: Context): JSONArray {
    var viaOnvif: Map<String, Int> = emptyMap()
    val t = Thread { viaOnvif = onvif(contexto) }.apply { start() }
    val portas = varrer()
    t.join()
    val ips = (portas.keys + viaOnvif.keys).toSortedSet(compareBy { it.substringAfterLast('.').toIntOrNull() ?: 0 })
    val r = JSONArray()
    for (ip in ips) {
      val p = portas[ip] ?: emptySet()
      var tipo = "rtsp"
      var porta: Int? = when { 554 in p -> 554; 8554 in p -> 8554; 10554 in p -> 10554; else -> null }
      var url = ""
      when {
        34567 in p -> { tipo = "xiongmai"; porta = 34567 }
        // outro celular com o CCTV Express Câmera: o vídeo é o RTSP na 8554
        8555 in p && 8554 in p -> { tipo = "rtsp"; porta = 8554; url = "rtsp://$ip:8554/" }
        viaOnvif.containsKey(ip) -> { tipo = "onvif"; porta = viaOnvif[ip] }
        8899 in p -> { tipo = "onvif"; porta = 8899 }
      }
      val marca = when { 34567 in p -> "xiongmai"; 8555 in p && 8554 in p -> "celular"; 37777 in p -> "dahua"; 8000 in p && porta != null -> "hikvision"; else -> null }
      // só porta 80 aberta e sem resposta ONVIF: roteador, impressora etc., não câmera
      if (tipo == "rtsp" && porta == null) continue
      r.put(JSONObject().put("ip", ip).put("tipo", tipo).put("porta", porta).put("marca", marca ?: JSONObject.NULL)
        .put("url", url).put("portas", JSONArray(p.sorted())).put("onvif", viaOnvif.containsKey(ip)))
    }
    return r
  }
}
