import { useState, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Upload, ArrowRight, FileText, Image as ImageIcon, Braces, X } from "lucide-react";
import {
  ACCEPTED_EXTENSIONS,
  FORMATS,
  GROUPS,
  NEW_CONVERSIONS,
  conversionKey,
  detectFormat,
  formatMeta,
  targetsFor,
  type FormatKey,
  type GroupKey,
} from "@/lib/convert-formats";

export interface Choice {
  from: FormatKey;
  to: FormatKey;
  /** O arquivo que o usuário já soltou, quando ele começou por aí. */
  file: File | null;
}

interface Props {
  onChoose: (choice: Choice) => void;
  /** Texto de apoio da área de arrastar, para a home e o painel dizerem coisas diferentes. */
  hint?: string;
}

const GROUP_ICON: Record<GroupKey, typeof FileText> = {
  documentos: FileText,
  imagens: ImageIcon,
  dados: Braces,
};

/** Botão de destino: "→ PDF", "→ WEBP". */
const TargetButton = ({
  from,
  to,
  onPick,
}: {
  from: FormatKey;
  to: FormatKey;
  onPick: (to: FormatKey) => void;
}) => {
  const meta = formatMeta(to);
  if (!meta) return null;

  return (
    <button
      type="button"
      onClick={() => onPick(to)}
      className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary/60 hover:bg-primary/5"
    >
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-primary" />
      {meta.short}
      {NEW_CONVERSIONS.has(conversionKey(from, to)) && (
        <Badge variant="secondary" className="px-1 py-0 text-[10px]">Novo</Badge>
      )}
    </button>
  );
};

/**
 * Escolha da conversão: arraste o arquivo (detectamos o formato) ou navegue
 * pela grade agrupada por formato de origem.
 *
 * Este componente é deliberadamente leve — só depende do catálogo de formatos.
 * Os motores de conversão (jsPDF, pdf.js, xlsx, ffmpeg) só entram depois que
 * uma conversão é escolhida, para não pesarem no carregamento da página.
 */
const ConverterPicker = ({ onChoose, hint }: Props) => {
  const [file, setFile] = useState<File | null>(null);
  const [from, setFrom] = useState<FormatKey | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFile = useCallback((picked: File) => {
    const detected = detectFormat(picked.name, picked.type);

    if (!detected || targetsFor(detected).length === 0) {
      setUnsupported(picked.name);
      setFile(null);
      setFrom(null);
      return;
    }

    setUnsupported(null);
    setFile(picked);
    setFrom(detected);
  }, []);

  const clear = () => {
    setFile(null);
    setFrom(null);
    setUnsupported(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const fromMeta = from ? formatMeta(from) : undefined;

  // Arquivo já detectado: só falta dizer para onde vai.
  if (file && from && fromMeta) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 p-4">
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{file.name}</p>
            <p className="text-sm text-muted-foreground">Detectamos: {fromMeta.label}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={clear} aria-label="Remover arquivo">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div>
          <p className="mb-3 font-heading text-foreground">Converter para:</p>
          <div className="flex flex-wrap gap-2">
            {targetsFor(from).map((target) => (
              <TargetButton
                key={target}
                from={from}
                to={target}
                onPick={(to) => onChoose({ from, to, file })}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = e.dataTransfer.files[0];
          if (dropped) acceptFile(dropped);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
      >
        <Upload className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <p className="mb-2 font-heading text-lg text-foreground">Arraste seu arquivo aqui</p>
        <p className="text-sm text-muted-foreground">
          {hint ?? "Detectamos o formato e mostramos para onde dá para converter"}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) acceptFile(picked);
          }}
          className="hidden"
        />
      </div>

      {unsupported && (
        <p className="text-center text-sm text-destructive">
          Ainda não convertemos <span className="font-medium">{unsupported}</span>. Veja abaixo os formatos aceitos.
        </p>
      )}

      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <div className="line-gold flex-1" />
          <span className="text-sm font-medium text-muted-foreground">Ou escolha pelo formato de origem</span>
          <div className="line-gold flex-1" />
        </div>

        {GROUPS.map((group) => {
          const sources = FORMATS.filter(
            (f) => f.group === group.key && targetsFor(f.key).length > 0,
          );
          if (!sources.length) return null;
          const GroupIcon = GROUP_ICON[group.key];

          return (
            <section key={group.key} className="space-y-3">
              <div className="flex items-center gap-2">
                <GroupIcon className="h-4 w-4 text-primary" />
                <h3 className="font-heading text-foreground">{group.label}</h3>
                <span className="text-xs text-muted-foreground">{group.description}</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {sources.map((source) => (
                  <div key={source.key} className="rounded-lg border border-border bg-card p-4">
                    <p className="mb-3 font-heading text-sm text-foreground">{source.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {targetsFor(source.key).map((target) => (
                        <TargetButton
                          key={target}
                          from={source.key}
                          to={target}
                          onPick={(to) => onChoose({ from: source.key, to, file: null })}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default ConverterPicker;
