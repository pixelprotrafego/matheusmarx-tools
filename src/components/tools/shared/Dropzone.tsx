import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { checkSize, sanitizeFilename, looksLike, type SizeKind } from "@/lib/validate-file";

interface Props {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  title?: string;
  hint?: string;
  sizeKind?: SizeKind;
}

// Inferência automática de tipo a partir do accept — evita ter que setar prop em cada caller.
function inferKind(accept?: string): SizeKind {
  const a = (accept ?? "").toLowerCase();
  if (a.includes("pdf")) return "pdf";
  if (a.includes("video/")) return "video";
  if (a.includes("audio/")) return "audio";
  if (a.includes("image/")) return "image";
  return "text";
}

// Validação opcional de magic bytes baseada no accept.
async function validateMagic(file: File, accept?: string): Promise<string | null> {
  const a = (accept ?? "").toLowerCase();
  const acceptTokens = a.split(",").map((token) => token.trim()).filter(Boolean);
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const isPdfFile = file.type === "application/pdf" || ext === "pdf";
  const isPngFile = file.type === "image/png" || ext === "png";
  const acceptsPng = acceptTokens.includes("image/png") || acceptTokens.includes(".png");
  const onlyAcceptsPng = acceptsPng && acceptTokens.every((token) => token === "image/png" || token === ".png");
  try {
    if (a.includes("pdf") && isPdfFile) {
      if (!(await looksLike(file, "pdf"))) return "Conteúdo do arquivo não corresponde a um PDF válido.";
    } else if (a.includes(".docx") || a.includes(".xlsx") || a.includes("officedocument")) {
      if (!(await looksLike(file, "zip"))) return "Arquivo Office inválido (esperado ZIP/OOXML).";
    } else if (onlyAcceptsPng || (acceptsPng && isPngFile)) {
      if (!(await looksLike(file, "png"))) return "Arquivo não é um PNG válido.";
    }
  } catch {
    // não bloqueia se a leitura falhar
  }
  return null;
}

const Dropzone = ({ onFiles, accept, multiple, title, hint, sizeKind }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const handleFiles = useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) return;
      // Honeypot: humano nunca preenche esse campo. Se vier preenchido, abortar silenciosamente.
      if (honeypotRef.current && honeypotRef.current.value) {
        console.warn("[honeypot] submissão bloqueada");
        return;
      }
      let arr = Array.from(list);
      const kind: SizeKind = sizeKind ?? inferKind(accept);
      const rejected: string[] = [];
      const accepted: File[] = [];
      for (const f of arr) {
        const sizeErr = checkSize(f, kind);
        if (sizeErr) { rejected.push(`${f.name}: ${sizeErr}`); continue; }
        const magicErr = await validateMagic(f, accept);
        if (magicErr) { rejected.push(`${f.name}: ${magicErr}`); continue; }
        accepted.push(f);
      }
      if (rejected.length) toast.error("Arquivo(s) rejeitado(s)", { description: rejected.join("\n") });
      if (!accepted.length) return;
      arr = accepted;
      // Sanitização defensiva do nome (cria novo File com nome limpo)
      arr = arr.map((f) =>
        new File([f], sanitizeFilename(f.name), { type: f.type, lastModified: f.lastModified })
      );
      onFiles(multiple ? arr : [arr[0]]);
    },
    [onFiles, multiple, sizeKind, accept]
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
        drag ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
      }`}
    >
      <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
      <p className="text-base font-heading text-foreground mb-1">{title ?? "Arraste seus arquivos aqui"}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />
      {/* Honeypot — invisível, fora do tab order, ignorado por leitores de tela. */}
      <input
        ref={honeypotRef}
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute opacity-0 pointer-events-none h-0 w-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};

export default Dropzone;