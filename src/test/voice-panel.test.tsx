import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import VoiceToolsPanel from "@/components/tools/VoiceToolsPanel";
import { resetVoiceStatusForTests } from "@/lib/voice-api";

beforeEach(resetVoiceStatusForTests);
afterEach(() => vi.unstubAllGlobals());

describe("VoiceToolsPanel", () => {
  it("lista as duas ferramentas de voz", async () => {
    render(<VoiceToolsPanel />);
    expect(await screen.findByText("Transcrição de Áudio")).toBeInTheDocument();
    expect(screen.getByText("Texto para Fala")).toBeInTheDocument();
  });

  it("sem servidor, a transcrição explica o motivo em vez de mostrar o botão", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } })));
    render(<VoiceToolsPanel />);
    fireEvent.click(await screen.findByText("Transcrição de Áudio"));

    expect(await screen.findByText("Indisponível nesta instalação")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Transcrever áudio/ })).not.toBeInTheDocument();
  });

  it("com servidor, o botão aparece", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, voice: true }), { headers: { "Content-Type": "application/json" } })));
    render(<VoiceToolsPanel />);
    fireEvent.click(await screen.findByText("Texto para Fala"));

    expect(await screen.findByRole("button", { name: /Gerar áudio/ })).toBeInTheDocument();
  });
});
