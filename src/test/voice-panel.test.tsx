import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import VoiceToolsPanel from "@/components/tools/VoiceToolsPanel";

describe("VoiceToolsPanel", () => {
  it("lista as duas ferramentas de voz", async () => {
    render(<VoiceToolsPanel />);
    expect(await screen.findByText("Transcrição de Áudio")).toBeInTheDocument();
    expect(screen.getByText("Texto para Fala")).toBeInTheDocument();
  });
});
