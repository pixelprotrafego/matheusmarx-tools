import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

const saveAs = vi.fn();
vi.mock("file-saver", () => ({ saveAs: (...args: unknown[]) => saveAs(...args) }));
vi.mock("@/lib/abuse-guard", () => ({
  guard: () => ({ ok: true, remainingHour: 1, remainingDay: 1, resetInMs: 0 }),
  guardMessage: () => "",
}));

import PdfMerger from "@/components/tools/PdfMerger";

async function pdf(texto: string, senhas?: { ownerPassword: string; userPassword?: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 200]).drawText(texto, { x: 20, y: 100, size: 14, font: fonte });
  if (senhas) doc.encrypt({ ...senhas, permissions: { modifying: false } });
  return doc.save();
}

const arquivo = (bytes: Uint8Array, nome: string) => new File([bytes], nome, { type: "application/pdf" });

function soltar(...files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

// O jsdom não implementa Blob.arrayBuffer(), que todo navegador tem.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(leitor.result as ArrayBuffer);
      leitor.onerror = () => reject(leitor.error);
      leitor.readAsArrayBuffer(this);
    });
  };
}

beforeEach(() => saveAs.mockReset());

describe("PdfMerger", () => {
  it("aponta qual arquivo pede senha, desbloqueia e une todos", async () => {
    render(<PdfMerger />);
    soltar(
      arquivo(await pdf("comum"), "comum.pdf"),
      arquivo(await pdf("bloqueado", { ownerPassword: "dono" }), "extrato-banco.pdf"),
      arquivo(await pdf("trancado", { ownerPassword: "dono", userPassword: "segredo" }), "contrato.pdf"),
    );

    // O de senha de proprietário é desbloqueado sozinho; o de abertura pede senha.
    expect(await screen.findByText("desbloqueado")).toBeInTheDocument();
    expect(await screen.findByLabelText("Senha de contrato.pdf")).toBeInTheDocument();
    expect(screen.getByText("pede senha")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unir 3 PDFs/ })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Senha de contrato.pdf"), { target: { value: "errada" } });
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
    expect(await screen.findByText("senha incorreta")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Senha de contrato.pdf"), { target: { value: "segredo" } });
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
    await waitFor(() => expect(screen.getAllByText("desbloqueado")).toHaveLength(2));

    const unir = screen.getByRole("button", { name: /Unir 3 PDFs/ });
    expect(unir).toBeEnabled();
    fireEvent.click(unir);
    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));

    const blob = saveAs.mock.calls[0][0] as Blob;
    const unido = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
    expect(unido.getPageCount()).toBe(3);
    expect(unido.isEncrypted).toBe(false);
  });

  it("marca o arquivo que não abre, com o nome dele", async () => {
    render(<PdfMerger />);
    soltar(arquivo(await pdf("ok"), "bom.pdf"), arquivo(new Uint8Array([1, 2, 3]), "quebrado.pdf"));

    expect(await screen.findByText("não abre")).toBeInTheDocument();
    expect(screen.getByText(/Este arquivo não pôde ser aberto/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unir 2 PDFs/ })).toBeDisabled();
  });
});
