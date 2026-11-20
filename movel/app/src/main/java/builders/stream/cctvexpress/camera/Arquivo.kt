// O arquivo de configuração rápida (.cctvx), o mesmo do CCTV Express do computador, para levar as câmeras do PC para o
// celular e do celular para o PC. Com senha, o conteúdo inteiro vai cifrado (AES-256-GCM, chave por PBKDF2-SHA256 com
// 210 mil voltas) e leva as senhas das câmeras; sem senha, vai legível e sem as senhas das câmeras.
//   aberto:  {"formato":"cctv-express","versao":1,"cifrado":false,"cameras":[...],"config":{...}}
//   cifrado: {"formato":"cctv-express","versao":1,"cifrado":true,"kdf":"pbkdf2-sha256","voltas":210000,
//             "sal":"<b64>","iv":"<b64>","dados":"<b64 do texto cifrado + etiqueta GCM>"}
package builders.stream.cctvexpress.camera

import android.util.Base64
import org.json.JSONObject
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object Arquivo {
  const val FORMATO = "cctv-express"
  private const val VOLTAS = 210_000

  class SenhaErrada : Exception()
  class Invalido : Exception()

  /** PBKDF2-HMAC-SHA256 (o Android só traz pronto a partir do 8.0; o app roda desde o 7.0). */
  private fun pbkdf2(senha: String, sal: ByteArray, voltas: Int): ByteArray {
    val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(senha.toByteArray(Charsets.UTF_8), "HmacSHA256")) }
    var u = mac.doFinal(sal + byteArrayOf(0, 0, 0, 1))
    val t = u.copyOf()
    repeat(voltas - 1) {
      u = mac.doFinal(u)
      for (i in t.indices) t[i] = (t[i].toInt() xor u[i].toInt()).toByte()
    }
    return t
  }

  private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)

  fun montar(conteudo: JSONObject, senha: String): String {
    if (senha.isEmpty()) {
      return JSONObject(conteudo.toString()).put("formato", FORMATO).put("versao", 1).put("cifrado", false).toString(2)
    }
    val sal = ByteArray(16).also { SecureRandom().nextBytes(it) }
    val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(pbkdf2(senha, sal, VOLTAS), "AES"), GCMParameterSpec(128, iv))
    val dados = c.doFinal(conteudo.toString().toByteArray(Charsets.UTF_8))
    return JSONObject().put("formato", FORMATO).put("versao", 1).put("cifrado", true).put("kdf", "pbkdf2-sha256")
      .put("voltas", VOLTAS).put("sal", b64(sal)).put("iv", b64(iv)).put("dados", b64(dados)).toString(2)
  }

  fun cifrado(texto: String): Boolean = try { JSONObject(texto).optBoolean("cifrado") } catch (_: Exception) { false }

  /** O conteúdo ({cameras, config}); lança SenhaErrada ou Invalido. */
  fun ler(texto: String, senha: String): JSONObject {
    val j = try { JSONObject(texto) } catch (_: Exception) { throw Invalido() }
    if (j.optString("formato") != FORMATO) throw Invalido()
    if (!j.optBoolean("cifrado")) return j
    try {
      val sal = Base64.decode(j.getString("sal"), Base64.NO_WRAP)
      val iv = Base64.decode(j.getString("iv"), Base64.NO_WRAP)
      val c = Cipher.getInstance("AES/GCM/NoPadding")
      c.init(Cipher.DECRYPT_MODE, SecretKeySpec(pbkdf2(senha, sal, j.optInt("voltas", VOLTAS)), "AES"), GCMParameterSpec(128, iv))
      return JSONObject(String(c.doFinal(Base64.decode(j.getString("dados"), Base64.NO_WRAP)), Charsets.UTF_8))
    } catch (_: javax.crypto.AEADBadTagException) { throw SenhaErrada() } catch (_: Exception) { throw Invalido() }
  }
}
