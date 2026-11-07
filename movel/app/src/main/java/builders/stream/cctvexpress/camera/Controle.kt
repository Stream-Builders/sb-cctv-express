// O canal de controle do CCTV Express Câmera: um HTTP mínimo na rede local (porta 8555) para o CCTV Express do
// computador ler o estado e acender ou apagar a luz do celular. Exige o mesmo usuário e senha do vídeo (Basic).
//   GET  /estado           -> {"app":"cctv-express-camera","aoVivo":..,"luz":..}
//   POST /luz?acesa=1|0    -> {"luz":..}
package builders.stream.cctvexpress.camera

import android.util.Base64
import org.json.JSONObject
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import kotlin.concurrent.thread

class Controle(private val porta: Int, usuario: String, senha: String, private val tela: MainActivity) {
  private val esperado = "Basic " + Base64.encodeToString("$usuario:$senha".toByteArray(), Base64.NO_WRAP)
  private var servidor: ServerSocket? = null

  fun iniciar() {
    thread(isDaemon = true, name = "controle") {
      try {
        val s = ServerSocket(porta).also { servidor = it }
        while (!s.isClosed) {
          val c = try { s.accept() } catch (_: Exception) { break }
          thread(isDaemon = true) { atender(c) }
        }
      } catch (_: Exception) { /* porta ocupada: o celular segue como câmera, só sem o controle */ }
    }
  }

  fun parar() { try { servidor?.close() } catch (_: Exception) {} }

  private fun igual(a: String, b: String) = MessageDigest.isEqual(a.toByteArray(), b.toByteArray())

  private fun atender(c: Socket) {
    c.use { sock ->
      sock.soTimeout = 5000
      val entrada = sock.getInputStream().bufferedReader()
      val linha = entrada.readLine() ?: return
      var auth = ""
      while (true) {
        val h = entrada.readLine() ?: break
        if (h.isEmpty()) break
        if (h.startsWith("Authorization:", ignoreCase = true)) auth = h.substringAfter(':').trim()
      }
      val partes = linha.split(' ')
      val metodo = partes.getOrNull(0) ?: ""
      val alvo = partes.getOrNull(1) ?: "/"
      val caminho = alvo.substringBefore('?')
      val consulta = alvo.substringAfter('?', "")
      val (codigo, corpo) = when {
        !igual(auth, esperado) -> 401 to """{"erro":"autenticacao"}"""
        metodo == "GET" && caminho == "/estado" -> 200 to JSONObject(tela.estadoJson())
          .put("app", "cctv-express-camera").also { it.remove("credenciais"); it.remove("endereco"); it.remove("ajuda") }.toString()
        metodo == "POST" && caminho == "/luz" -> {
          val acesa = consulta.split('&').any { it == "acesa=1" }
          200 to JSONObject().put("luz", tela.definirLuz(acesa)).toString()
        }
        else -> 404 to """{"erro":"nao encontrado"}"""
      }
      val bytes = corpo.toByteArray()
      val status = mapOf(200 to "OK", 401 to "Unauthorized", 404 to "Not Found")[codigo]
      val cab = "HTTP/1.1 $codigo $status\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n" +
        (if (codigo == 401) "WWW-Authenticate: Basic realm=\"cctv\"\r\n" else "") + "\r\n"
      sock.getOutputStream().apply { write(cab.toByteArray()); write(bytes); flush() }
    }
  }
}
