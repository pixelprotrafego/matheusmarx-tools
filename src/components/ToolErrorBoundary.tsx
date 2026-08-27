import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Nome da área protegida, usado na mensagem e no log. */
  area?: string;
  /** Muda de valor quando o usuário navega, para limpar o erro anterior. */
  resetKey?: string | number | null;
}

interface State {
  error: Error | null;
}

/**
 * Sem uma fronteira de erro, uma exceção durante o render desmonta a árvore
 * inteira e o usuário fica olhando para uma página vazia, sem nenhuma pista do
 * que aconteceu. Esta fronteira isola a falha na ferramenta que a causou e
 * mostra a mensagem real, que é o que torna o problema diagnosticável.
 */
class ToolErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.area ?? "app"}] falhou:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="font-heading font-medium text-foreground">
              {this.props.area
                ? `A ferramenta "${this.props.area}" não pôde ser carregada`
                : "Algo deu errado"}
            </p>
            <p className="text-sm text-muted-foreground">
              As outras ferramentas continuam funcionando normalmente.
            </p>
          </div>
        </div>

        <pre className="text-xs bg-background/60 border border-border rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-words text-muted-foreground">
          {error.message || String(error)}
        </pre>

        <Button
          variant="outline"
          size="sm"
          onClick={() => this.setState({ error: null })}
          className="gap-1.5"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Tentar novamente
        </Button>
      </div>
    );
  }
}

export default ToolErrorBoundary;
