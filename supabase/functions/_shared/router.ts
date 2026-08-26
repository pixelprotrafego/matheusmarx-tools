import { evaluate, formatNumber } from "./calc-engine.ts";
import { CATEGORIES, convert, formatConverted } from "./unit-conversions.ts";
import { generatePassword } from "./password.ts";
import { groqSpeech } from "./groq.ts";

export interface CmdResult {
  text?: string;
  // For binary results (qr image) we return a blob with filename.
  blob?: Blob;
  filename?: string;
  asPhoto?: boolean;
}

function findUnit(idOrLabel: string) {
  const q = idOrLabel.toLowerCase().trim();
  for (const cat of CATEGORIES) {
    for (const u of cat.units) {
      if (u.id.toLowerCase() === q) return { cat, unit: u };
    }
  }
  // Aliases comuns
  const aliases: Record<string, string> = {
    "km/h": "kmh", "kmh": "kmh", "m/s": "mps", "ft/s": "fps",
    "metros": "m", "metro": "m", "quilometro": "km", "quilômetro": "km",
    "milhas": "mi", "milha": "mi", "polegada": "in", "polegadas": "in",
    "celsius": "C", "fahrenheit": "F", "kelvin": "K",
    "kg": "kg", "g": "g", "lb": "lb", "libra": "lb",
  };
  if (aliases[q]) {
    for (const cat of CATEGORIES) {
      const u = cat.units.find((u) => u.id === aliases[q]);
      if (u) return { cat, unit: u };
    }
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

export async function runCommand(cmd: string, args: string): Promise<CmdResult> {
  switch (cmd) {
    case "/start":
    case "/help":
      return { text: HELP_TEXT };

    case "/calc": {
      if (!args.trim()) return { text: "Uso: <code>/calc 2+2*5</code>" };
      try {
        const r = evaluate(args, "deg");
        return { text: `<b>${args}</b>\n= <code>${formatNumber(r)}</code>` };
      } catch (e) {
        return { text: `❌ ${e instanceof Error ? e.message : "Erro no cálculo"}` };
      }
    }

    case "/conv": {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 3) {
        return { text: "Uso: <code>/conv 10 km mi</code>\nUnidades: m, km, mi, kg, lb, C, F, K, kmh, mph..." };
      }
      const v = parseFloat(parts[0].replace(",", "."));
      if (!Number.isFinite(v)) return { text: "Valor inválido." };
      const from = findUnit(parts[1]);
      const to = findUnit(parts[2]);
      if (!from || !to) return { text: "Unidade desconhecida. Use IDs como: m, km, mi, kg, lb, C, F, K, kmh, mph, etc." };
      if (from.cat.key !== to.cat.key) return { text: `Categorias diferentes: ${from.cat.label} ≠ ${to.cat.label}` };
      const out = convert(v, from.cat, from.unit.id, to.unit.id);
      return { text: `<b>${v} ${from.unit.id}</b> = <code>${formatConverted(out)} ${to.unit.id}</code>` };
    }

    case "/qr": {
      if (!args.trim()) return { text: "Uso: <code>/qr https://exemplo.com</code>" };
      const QR = (await import("npm:qrcode@1.5.4")).default;
      const png = await QR.toBuffer(args, { width: 512, margin: 1, errorCorrectionLevel: "M" });
      return {
        blob: new Blob([png], { type: "image/png" }),
        filename: "qrcode.png",
        asPhoto: true,
      };
    }

    case "/senha": {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const length = parseInt(parts[0] ?? "16", 10) || 16;
      const wantsSymbols = parts.includes("sym") || parts.includes("symbols") || parts.includes("simbolos");
      const pw = generatePassword({ length, upper: true, digits: true, symbols: wantsSymbols });
      return { text: `🔐 <code>${pw}</code>\n<i>${length} chars${wantsSymbols ? " · com símbolos" : ""}</i>` };
    }

    case "/tts": {
      if (!args.trim()) return { text: "Uso: <code>/tts [voice=austin] Hello world</code>\nVozes: austin, leo, dan, mia, zoe, jess, tara, leah" };
      let voice = "austin";
      let text = args.trim();
      const m = text.match(/^voice=([a-z]+)\s+(.*)$/i);
      if (m) { voice = m[1].toLowerCase(); text = m[2]; }
      if (text.length > 4000) return { text: "❌ Texto excede 4000 caracteres." };
      try {
        const r = await groqSpeech({ text, voice, format: "wav" });
        return {
          blob: new Blob([r.bytes], { type: r.mime }),
          filename: `tts-${voice}.wav`,
          asPhoto: false,
        };
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === "model_terms_required") {
          return { text: "⚠️ O modelo de voz Orpheus está bloqueado no provedor: o admin da organização Groq precisa aceitar os termos do modelo. Tente novamente depois." };
        }
        return { text: `❌ ${e instanceof Error ? e.message : "Falha no TTS"}` };
      }
    }

    default:
      return { text: `Comando desconhecido: <code>${cmd}</code>\nUse /help.` };
  }
}