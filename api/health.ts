import { json } from "./_lib/http.js";
import { isGroqConfigured } from "./_lib/groq.js";

/**
 * GET /api/health — diz ao site se as ferramentas de áudio estão disponíveis.
 *
 * O site consulta esta rota antes de mostrar a transcrição e o texto para fala.
 * Onde não existe servidor — a imagem Docker, que é só um nginx servindo
 * arquivos — a resposta não é JSON, e as ferramentas aparecem desligadas com
 * uma explicação, em vez de falhar na hora do clique.
 *
 * Revela apenas se a chave existe, nunca o valor.
 */
export function GET(): Response {
  return json({ ok: true, voice: isGroqConfigured() });
}
