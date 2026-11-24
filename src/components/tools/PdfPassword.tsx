import { useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, FileText } from "lucide-react";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import PdfPasswordPrompt from "./shared/PdfPasswordPrompt";
import { usePdfPassword } from "./shared/use-pdf-password";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadBlob, bytesToBlob } from "@/lib/download";
import { loadPdfLib, openPdf } from "@/lib/pdf-unlock";
import { formatReset } from "@/lib/rate-limit";
import { guard, guardMessage } from "@/lib/abuse-guard";

/** Senha de proprietário que ninguém precisa saber, para as restrições valerem. */
function randomOwnerPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Confere o arquivo pronto antes de entregá-lo: sem senha ele não pode abrir,
 * com uma senha errada também não, e com a senha certa precisa abrir inteiro.
 * Um "PDF protegido" que abre sem senha seria pior do que nenhum, porque a
 * pessoa confiaria nele.
 */
async function verifyProtection(bytes: Uint8Array, password: string, pages: number): Promise<void> {
  const { PDFDocument, EncryptedPDFError } = await loadPdfLib();
  const opensWith = async (pw: string | undefined) => {
    try {
      await PDFDocument.load(bytes, pw === undefined ? {} : { password: pw });
      return true;
    } catch {
      return false;
    }
  };
  let refusedPlain = false;
  try {
    await PDFDocument.load(bytes);
  } catch (e) {
    refusedPlain = e instanceof EncryptedPDFError;
  }
  const wrong = password === "x" ? "y" : "x";
  const ok =
    refusedPlain &&
    !(await opensWith("")) &&
    !(await opensWith(wrong)) &&
    (await PDFDocument.load(bytes, { password })).getPageCount() === pages;
  if (!ok) throw new Error("A proteção não pôde ser confirmada no arquivo gerado. Nada foi baixado; tente novamente.");
}

const PdfPassword = () => {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [allowPrint, setAllowPrint] = useState(true);
  const [allowCopy, setAllowCopy] = useState(true);
  const [allowEdit, setAllowEdit] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Senha do arquivo de entrada, quando ele já vem protegido.
  const inputPassword = usePdfPassword();

  const chooseFile = (f: File | null) => {
    setFile(f);
    setError(null);
    inputPassword.reset();
  };

  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = Boolean(file) && password.length > 0 && password === confirm;

  const go = async (currentPassword = inputPassword.password) => {
    if (!file || !ready) return;
    const rl = guard("pdf-password", { hourly: 20, daily: 80 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : { description: `Tente novamente em ${formatReset(rl.resetInMs)}.` });
      return;
    }
    setLoading(true); setError(null);
    try {
      const opened = await openPdf(await file.arrayBuffer(), currentPassword);
      const pages = opened.doc.getPageCount();
      const restricted = !allowPrint || !allowCopy || !allowEdit;
      opened.doc.encrypt({
        userPassword: password,
        // Sem restrição, a mesma senha serve de proprietário. Com restrição,
        // a de proprietário precisa ser outra, senão quem abre com a senha
        // ganha acesso total e as restrições não valem nada.
        ownerPassword: restricted ? randomOwnerPassword() : password,
        permissions: {
          printing: allowPrint ? "highResolution" : false,
          copying: allowCopy,
          // Leitor de tela continua funcionando mesmo sem permissão de cópia.
          contentAccessibility: true,
          modifying: allowEdit,
          annotating: allowEdit,
          fillingForms: allowEdit,
          documentAssembly: allowEdit,
        },
      });
      const bytes = await opened.doc.save();
      await verifyProtection(bytes, password, pages);
      downloadBlob(bytesToBlob(bytes, "application/pdf"), file.name.replace(/\.pdf$/i, "") + "-protegido.pdf");
      toast.success("PDF protegido com senha (AES-256).");
      setPassword("");
      setConfirm("");
      chooseFile(null);
    } catch (e) {
      if (!inputPassword.catchPassword(e)) setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {!file ? (
        <Dropzone onFiles={(fs) => chooseFile(fs[0])} accept="application/pdf,.pdf" title="Arraste o PDF" />
      ) : (
        <FileBadge file={file} icon={<FileText className="w-4 h-4 text-primary" />} onRemove={() => chooseFile(null)} />
      )}

      {inputPassword.request && (
        <PdfPasswordPrompt
          reason={inputPassword.request}
          busy={loading}
          onSubmit={(pw) => { inputPassword.provide(pw); void go(pw); }}
        />
      )}

      {file && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pdf-new-password">Nova senha</Label>
              <div className="flex gap-2">
                <Input
                  id="pdf-new-password"
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? "Esconder senha" : "Mostrar senha"}
                  className="shrink-0"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pdf-confirm-password">Confirme a senha</Label>
              <Input
                id="pdf-confirm-password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={mismatch || undefined}
              />
              {mismatch && <p className="text-xs text-destructive">As senhas não conferem.</p>}
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Quem abrir com a senha poderá:</legend>
            {[
              { id: "perm-print", label: "Imprimir", value: allowPrint, set: setAllowPrint },
              { id: "perm-copy", label: "Copiar texto e imagens", value: allowCopy, set: setAllowCopy },
              { id: "perm-edit", label: "Editar, comentar e preencher formulários", value: allowEdit, set: setAllowEdit },
            ].map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <Checkbox id={p.id} checked={p.value} onCheckedChange={(v) => p.set(v === true)} />
                <Label htmlFor={p.id} className="font-normal">{p.label}</Label>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Restrições são respeitadas pelos leitores de PDF comuns, mas a senha de abertura é a proteção de verdade.
            </p>
          </fieldset>
        </div>
      )}

      {error && <ErrorState message={error} onRetry={() => go()} />}
      {file && !error && !inputPassword.request && (
        <ConvertButton onClick={() => go()} loading={loading} disabled={!ready} label="Proteger PDF" />
      )}
    </div>
  );
};

export default PdfPassword;
