import { useState, lazy, Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Repeat, Wand2, ArrowLeft, FileStack, Type, Loader2, Palette, Calculator as CalcIcon, Mic, Scale } from "lucide-react";
import SiteHeader from "@/components/site/SiteHeader";
import Hero from "@/components/site/Hero";
import SiteFooter from "@/components/site/SiteFooter";
import ToolErrorBoundary from "@/components/ToolErrorBoundary";
// Importado direto, e não por lazy: o seletor de conversão é leve (só o
// catálogo de formatos) e é a primeira coisa que a página oferece. Os motores
// de conversão continuam sendo carregados sob demanda, dentro dele.
import FileConverter from "@/components/tools/FileConverter";

const MediaEditPanel = lazy(() => import("@/components/tools/MediaEditPanel"));
const PdfToolsPanel = lazy(() => import("@/components/tools/PdfToolsPanel"));
const TextToolsPanel = lazy(() => import("@/components/tools/TextToolsPanel"));
const CreativeToolsPanel = lazy(() => import("@/components/tools/CreativeToolsPanel"));
const CalcToolsPanel = lazy(() => import("@/components/tools/CalcToolsPanel"));
const VoiceToolsPanel = lazy(() => import("@/components/tools/VoiceToolsPanel"));
const AdvocaciaToolsPanel = lazy(() => import("@/components/tools/AdvocaciaToolsPanel"));

const PanelFallback = () => (
  <div className="flex items-center justify-center py-16 text-muted-foreground">
    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando ferramenta...
  </div>
);

type ClusterKey =
  | "voice-tools"
  | "creative-tools"
  | "calc-tools"
  | "advocacia-tools"
  | "pdf-tools"
  | "media-edit"
  | "text-tools"
  | null;

const clusters = [
  {
    key: "voice-tools" as const,
    icon: Mic,
    title: "Áudio & Voz",
    description: "Transcreva áudios em texto e gere narrações em voz natural",
    tags: ["Transcrição", "Texto → Fala", "Multi-idioma", "8 vozes"],
    newCount: 2,
  },
  {
    key: "creative-tools" as const,
    icon: Palette,
    title: "Notepad & Desenho",
    description: "Bloco de notas com formatação rica e prancheta de desenho livre",
    tags: ["Notepad", "Rich Text", "Desenho Livre", "Formas", "PNG/SVG", "TXT/MD/PDF/DOCX"],
    newCount: 2,
  },
  {
    key: "calc-tools" as const,
    icon: CalcIcon,
    title: "Calculadora & Conversões",
    description: "Calculadora científica e conversor de unidades (distância, peso, temperatura e mais)",
    tags: ["Científica", "Distância", "Peso", "Temperatura", "Velocidade", "Volume", "Área", "Tempo"],
    newCount: 2,
  },
  {
    key: "advocacia-tools" as const,
    icon: Scale,
    title: "Ferramentas para Advocacia",
    description: "Contagem de prazos processuais, número CNJ e cálculo de verbas rescisórias",
    tags: ["Prazos em dias úteis", "Recesso forense", "Validar CNJ", "Gerar CNJ", "Rescisão CLT", "FGTS + multa", "INSS/IRRF"],
    newCount: 4,
  },
  {
    key: "pdf-tools" as const,
    icon: FileStack,
    title: "Ferramentas PDF",
    description: "Unir, separar, rotacionar, comprimir, marca d'água e mais",
    tags: ["Unir", "Separar", "Rotacionar", "Marca d'água", "Comprimir", "Reordenar", "Achatar", "Extrair PNG"],
    newCount: 7,
  },
  {
    key: "media-edit" as const,
    icon: Wand2,
    title: "Edição de Imagem & Vídeo",
    description: "Converter áudio e vídeo, redimensionar, comprimir, remover fundo, cortar e unir vídeos, extrair frames e áudio",
    tags: ["Converter áudio/vídeo", "MP4/MKV/WEBM", "MP3/WAV/FLAC/OPUS", "Redimensionar", "Comprimir", "Remover Fundo (IA)", "Favicon", "Cortar", "Unir", "GIF", "Frames"],
    newCount: 9,
  },
  {
    key: "text-tools" as const,
    icon: Type,
    title: "Privacidade & Utilitários",
    description: "QR Code, senhas, hashes, formatação e ferramentas de privacidade no navegador",
    tags: ["QR PNG", "Senhas fortes", "Limpar EXIF/PDF", "Mensagem oculta em PNG", "Base64", "SHA-1/256/512", "JSON"],
    newCount: 7,
  },
];

const Tools = () => {
  const [activeCluster, setActiveCluster] = useState<ClusterKey>(null);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="container max-w-5xl mx-auto px-4 py-12">
        {!activeCluster && <Hero />}

        {activeCluster && (
          <Button
            variant="ghost"
            onClick={() => setActiveCluster(null)}
            className="mb-6 gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar às ferramentas
          </Button>
        )}

        {!activeCluster && (
          <Card className="mb-10 border-primary/30 bg-card animate-fade-in">
            <CardHeader>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Repeat className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold leading-none tracking-tight mb-1.5">
                    Converter um arquivo
                  </h2>
                  <CardDescription>
                    Solte o arquivo e escolha o formato de saída. Tudo acontece no seu navegador.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ToolErrorBoundary area="Conversão de Arquivos" resetKey="home-converter">
                <FileConverter />
              </ToolErrorBoundary>
            </CardContent>
          </Card>
        )}

        {!activeCluster ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5 md:gap-6 animate-fade-in">
            {clusters.map((cluster, idx) => {
              const Icon = cluster.icon;
              return (
                <Card
                  key={cluster.key}
                  className="group cursor-pointer border-border bg-card hover:border-primary/40 hover:glow-gold hover:-translate-y-0.5 transition-all duration-300 animate-fade-in"
                  style={{ animationDelay: `${idx * 60}ms`, animationFillMode: "both" }}
                  onClick={() => setActiveCluster(cluster.key)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
                        <Icon className="w-6 h-6 text-primary" />
                      </div>
                      {cluster.newCount > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {cluster.newCount} novo{cluster.newCount > 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                    <h2 className="text-lg font-semibold leading-none tracking-tight">{cluster.title}</h2>
                    <CardDescription>{cluster.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1.5">
                      {cluster.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-xs px-2 py-1 rounded-md bg-secondary text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="animate-fade-in">
            <Card className="border-border bg-card">
              <CardHeader>
                <h2 className="text-xl font-semibold leading-none tracking-tight">
                  {clusters.find(c => c.key === activeCluster)?.title}
                </h2>
                <CardDescription>
                  {clusters.find(c => c.key === activeCluster)?.description}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ToolErrorBoundary
                  area={clusters.find((c) => c.key === activeCluster)?.title}
                  resetKey={activeCluster}
                >
                  <Suspense fallback={<PanelFallback />}>
                    {activeCluster === "voice-tools" && <VoiceToolsPanel />}
                    {activeCluster === "creative-tools" && <CreativeToolsPanel />}
                    {activeCluster === "calc-tools" && <CalcToolsPanel />}
                    {activeCluster === "advocacia-tools" && <AdvocaciaToolsPanel />}
                    {activeCluster === "pdf-tools" && <PdfToolsPanel />}
                    {activeCluster === "media-edit" && <MediaEditPanel />}
                    {activeCluster === "text-tools" && <TextToolsPanel />}
                  </Suspense>
                </ToolErrorBoundary>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
};

export default Tools;
