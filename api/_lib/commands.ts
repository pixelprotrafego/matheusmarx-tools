import QRCode from "qrcode";
// Os mesmos módulos que o site usa. Na plataforma anterior as edge functions
// não alcançavam nada fora da própria pasta e mantinham cópias espelhadas,
// que precisavam ser corrigidas nos dois lugares. Agora há uma fonte só.
import { evaluate, formatNumber } from "../../src/lib/calc-engine.js";
import { CATEGORIES, convert, formatConverted } from "../../src/lib/unit-conversions.js";
import { generatePassword } from "./password.js";
import { GroqError, groqSpeech, TTS_VOICES } from "./groq.js";
import { escapeHtml } from "./telegram.js";

export interface CommandResult {
  text?: string;
  /** Resultado binário (QR Code, áudio), enviado como foto ou documento. */
  blob?: Blob;
  filename?: string;
  asPhoto?: boolean;
}

const APELIDOS: Record<string, string> = {
  "km/h": "kmh", "m/s": "mps", "ft/s": "fps",
  metros: "m", metro: "m", quilometro: "km", "quilômetro": "km",
  milhas: "mi", milha: "mi", polegada: "in", polegadas: "in",
  celsius: "C", fahrenheit: "F", kelvin: "K", libra: "lb",
};

function acharUnidade(texto: string) {
  const q = texto.toLowerCase().trim();
  const id = APELIDOS[q] ?? q;
  for (const categoria of CATEGORIES) {
    const unidade = categoria.units.find((u) => u.id.toLowerCase() === id.toLowerCase());
    if (unidade) return { categoria, unidade };
  }
  return null;
}

export const HELP_TEXT =
  `<b>Comandos disponíveis</b>\n\n` +
  `<code>/calc 2+2*5</code> — calculadora científica\n` +
  `<code>/conv 10 km mi</code> — converte unidades\n` +
  `<code>/qr texto ou url</code> — gera QR Code\n` +
  `<code>/senha [tamanho] [sym]</code> — gera senha forte\n` +
  `<code>/tts [voice=austin] texto</code> — texto → fala (Orpheus, inglês)\n` +
  `<code>/help</code> — esta ajuda\n\n` +
  `<b>Envie também:</b>\n` +
  `🎙️ áudio/voz → transcrevo via Whisper\n` +
  `🖼️ imagem ou 📄 arquivo → mostro o que posso fazer\n\n` +
  `<i>v1 sem IA conversacional — só comandos diretos.</i>`;

export async function runCommand(cmd: string, args: string): Promise<CommandResult> {
  switch (cmd) {
    case "/start":
    case "/help":
      return { text: HELP_TEXT };

    case "/calc": {
      if (!args.trim()) return { text: "Uso: <code>/calc 2+2*5</code>" };
      try {
        return { text: `<b>${escapeHtml(args)}</b>\n= <code>${formatNumber(evaluate(args, "deg"))}</code>` };
      } catch (e) {
        return { text: `❌ ${e instanceof Error ? escapeHtml(e.message) : "Erro no cálculo"}` };
      }
    }

    case "/conv": {
      const partes = args.trim().split(/\s+/);
      if (partes.length < 3) {
        return { text: "Uso: <code>/conv 10 km mi</code>\nUnidades: m, km, mi, kg, lb, C, F, K, kmh, mph..." };
      }
      const valor = parseFloat(partes[0].replace(",", "."));
      if (!Number.isFinite(valor)) return { text: "Valor inválido." };
      const de = acharUnidade(partes[1]);
      const para = acharUnidade(partes[2]);
      if (!de || !para) return { text: "Unidade desconhecida. Use IDs como: m, km, mi, kg, lb, C, F, K, kmh, mph, etc." };
      if (de.categoria.key !== para.categoria.key) {
        return { text: `Categorias diferentes: ${de.categoria.label} ≠ ${para.categoria.label}` };
      }
      const resultado = convert(valor, de.categoria, de.unidade.id, para.unidade.id);
      return { text: `<b>${valor} ${de.unidade.id}</b> = <code>${formatConverted(resultado)} ${para.unidade.id}</code>` };
    }

    case "/qr": {
      if (!args.trim()) return { text: "Uso: <code>/qr https://exemplo.com</code>" };
      const png = await QRCode.toBuffer(args, { width: 512, margin: 1, errorCorrectionLevel: "M" });
      return { blob: new Blob([new Uint8Array(png)], { type: "image/png" }), filename: "qrcode.png", asPhoto: true };
    }

    case "/senha": {
      const partes = args.trim().split(/\s+/).filter(Boolean);
      const tamanho = parseInt(partes[0] ?? "16", 10) || 16;
      const simbolos = ["sym", "symbols", "simbolos"].some((p) => partes.includes(p));
      const senha = generatePassword({ length: tamanho, upper: true, digits: true, symbols: simbolos });
      return { text: `🔐 <code>${escapeHtml(senha)}</code>\n<i>${tamanho} chars${simbolos ? " · com símbolos" : ""}</i>` };
    }

    case "/tts": {
      if (!args.trim()) {
        return { text: `Uso: <code>/tts [voice=austin] Hello world</code>\nVozes: ${TTS_VOICES.join(", ")}` };
      }
      let voz = "austin";
      let texto = args.trim();
      const escolha = texto.match(/^voice=([a-z]+)\s+(.*)$/i);
      if (escolha) {
        voz = escolha[1].toLowerCase();
        texto = escolha[2];
      }
      if (!(TTS_VOICES as readonly string[]).includes(voz)) return { text: `❌ Voz inválida. Vozes: ${TTS_VOICES.join(", ")}` };
      if (texto.length > 4000) return { text: "❌ Texto excede 4000 caracteres." };
      try {
        const r = await groqSpeech({ text: texto, voice: voz, format: "wav" });
        return { blob: new Blob([r.bytes], { type: r.mime }), filename: `tts-${voz}.wav` };
      } catch (e) {
        if (e instanceof GroqError && e.code === "model_terms_required") {
          return { text: "⚠️ O modelo de voz Orpheus está bloqueado no provedor: o admin da organização Groq precisa aceitar os termos do modelo." };
        }
        return { text: `❌ ${e instanceof Error ? escapeHtml(e.message) : "Falha no TTS"}` };
      }
    }

    default:
      return { text: `Comando desconhecido: <code>${escapeHtml(cmd)}</code>\nUse /help.` };
  }
}
