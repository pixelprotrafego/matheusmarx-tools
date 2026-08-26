import { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { evaluate, formatNumber, type AngleMode } from "@/lib/calc-engine";
import { Delete, History } from "lucide-react";

type BtnKind = "num" | "op" | "fn" | "eq" | "clear";

interface Btn {
  label: string;
  insert?: string;
  kind: BtnKind;
  action?: "AC" | "DEL" | "=" | "SIGN";
  ariaLabel?: string;
}

const BASIC: Btn[] = [
  { label: "AC", kind: "clear", action: "AC" },
  { label: "±", kind: "fn", action: "SIGN" },
  { label: "%", kind: "fn", insert: "%" },
  { label: "÷", kind: "op", insert: "/" },
  { label: "7", kind: "num", insert: "7" },
  { label: "8", kind: "num", insert: "8" },
  { label: "9", kind: "num", insert: "9" },
  { label: "×", kind: "op", insert: "*" },
  { label: "4", kind: "num", insert: "4" },
  { label: "5", kind: "num", insert: "5" },
  { label: "6", kind: "num", insert: "6" },
  { label: "−", kind: "op", insert: "-" },
  { label: "1", kind: "num", insert: "1" },
  { label: "2", kind: "num", insert: "2" },
  { label: "3", kind: "num", insert: "3" },
  { label: "+", kind: "op", insert: "+" },
  { label: "0", kind: "num", insert: "0" },
  { label: ".", kind: "num", insert: "." },
  { label: "⌫", kind: "clear", action: "DEL" },
  { label: "=", kind: "eq", action: "=" },
];

const SCI: Btn[] = [
  { label: "sin", kind: "fn", insert: "sin(" },
  { label: "cos", kind: "fn", insert: "cos(" },
  { label: "tan", kind: "fn", insert: "tan(" },
  { label: "(", kind: "fn", insert: "(" },
  { label: ")", kind: "fn", insert: ")" },
  { label: "asin", kind: "fn", insert: "asin(" },
  { label: "acos", kind: "fn", insert: "acos(" },
  { label: "atan", kind: "fn", insert: "atan(" },
  { label: "ln", kind: "fn", insert: "ln(" },
  { label: "log", kind: "fn", insert: "log(" },
  { label: "x²", kind: "fn", insert: "^2" },
  { label: "xʸ", kind: "op", insert: "^" },
  { label: "√", kind: "fn", insert: "sqrt(" },
  { label: "1/x", kind: "fn", insert: "^-1" },
  { label: "!", kind: "fn", insert: "!" },
  { label: "π", kind: "num", insert: "pi" },
  { label: "e", kind: "num", insert: "e" },
  { label: "mod", kind: "op", insert: " mod " },
  { label: "exp", kind: "fn", insert: "exp(" },
  { label: "EE", kind: "op", insert: "*10^" },
];

const Calculator = () => {
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState("0");
  const [tab, setTab] = useState<"basic" | "sci">("basic");
  const [angle, setAngle] = useState<AngleMode>("deg");
  const [history, setHistory] = useState<Array<{ expr: string; result: string }>>([]);

  const live = useMemo(() => {
    if (!expr.trim()) return "";
    try {
      return formatNumber(evaluate(expr, angle));
    } catch {
      return "";
    }
  }, [expr, angle]);

  const handle = useCallback(
    (btn: Btn) => {
      if (btn.action === "AC") {
        setExpr("");
        setResult("0");
        return;
      }
      if (btn.action === "DEL") {
        setExpr((e) => e.slice(0, -1));
        return;
      }
      if (btn.action === "SIGN") {
        setExpr((e) => (e.startsWith("-") ? e.slice(1) : "-" + e));
        return;
      }
      if (btn.action === "=") {
        try {
          const r = formatNumber(evaluate(expr, angle));
          setResult(r);
          setHistory((h) => [{ expr, result: r }, ...h].slice(0, 8));
          setExpr(r);
        } catch {
          setResult("Erro");
        }
        return;
      }
      if (btn.insert !== undefined) setExpr((e) => e + btn.insert);
    },
    [expr, angle],
  );

  // Keyboard support
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (/^[0-9.]$/.test(k)) setExpr((v) => v + k);
      else if (["+", "-", "*", "/", "(", ")", "^", "%"].includes(k)) setExpr((v) => v + k);
      else if (k === "Enter" || k === "=") handle({ label: "=", kind: "eq", action: "=" });
      else if (k === "Backspace") setExpr((v) => v.slice(0, -1));
      else if (k === "Escape") { setExpr(""); setResult("0"); }
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handle]);

  const btnClass = (k: BtnKind) =>
    cn(
      "h-14 md:h-16 rounded-xl font-heading text-lg md:text-xl transition-all active:scale-95 select-none",
      k === "num" && "bg-secondary/80 hover:bg-secondary text-foreground",
      k === "op" && "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20",
      k === "fn" && "bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground text-base",
      k === "clear" && "bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/20",
      k === "eq" && "bg-gradient-to-br from-[hsl(var(--gold-light))] via-[hsl(var(--gold))] to-[hsl(var(--gold-dark))] text-primary-foreground hover:opacity-90 glow-gold col-span-1",
    );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-6">
      <div className="space-y-4">
        {/* Display */}
        <div className="rounded-2xl border border-border bg-secondary/30 p-5 md:p-6 min-h-[140px] flex flex-col justify-end backdrop-blur-sm">
          <div className="text-right text-sm text-muted-foreground font-mono break-all min-h-[20px]">
            {expr || "0"}
          </div>
          <div
            className={cn(
              "text-right font-heading break-all leading-tight mt-2",
              "text-4xl md:text-5xl",
              result === "Erro" ? "text-destructive" : "text-gradient-gold",
            )}
          >
            {live && live !== expr ? live : result}
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "basic" | "sci")}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TabsList>
              <TabsTrigger value="basic">Básica</TabsTrigger>
              <TabsTrigger value="sci">Científica</TabsTrigger>
            </TabsList>
            {tab === "sci" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAngle((a) => (a === "deg" ? "rad" : "deg"))}
                className="font-mono uppercase tracking-wider"
              >
                {angle}
              </Button>
            )}
          </div>

          <TabsContent value="basic" className="mt-4">
            <div className="grid grid-cols-4 gap-2 md:gap-3">
              {BASIC.map((b, i) => (
                <button key={i} className={btnClass(b.kind)} onClick={() => handle(b)} aria-label={b.label}>
                  {b.label === "⌫" ? <Delete className="w-5 h-5 mx-auto" /> : b.label}
                </button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="sci" className="mt-4 space-y-2 md:space-y-3">
            <div className="grid grid-cols-5 gap-2 md:gap-3">
              {SCI.map((b, i) => (
                <button key={i} className={btnClass(b.kind)} onClick={() => handle(b)} aria-label={b.label}>
                  {b.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2 md:gap-3">
              {BASIC.map((b, i) => (
                <button key={i} className={btnClass(b.kind)} onClick={() => handle(b)} aria-label={b.label}>
                  {b.label === "⌫" ? <Delete className="w-5 h-5 mx-auto" /> : b.label}
                </button>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* History */}
      <aside className="hidden lg:block">
        <div className="rounded-xl border border-border bg-card/40 p-4 sticky top-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
            <History className="w-4 h-4 text-primary" />
            <span className="font-medium">Histórico</span>
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground/70 italic">Sem cálculos ainda.</p>
          ) : (
            <ul className="space-y-3">
              {history.map((h, i) => (
                <li
                  key={i}
                  className="cursor-pointer group"
                  onClick={() => setExpr(h.result)}
                  title="Reutilizar resultado"
                >
                  <div className="text-xs text-muted-foreground font-mono break-all group-hover:text-foreground transition-colors">
                    {h.expr}
                  </div>
                  <div className="text-sm text-primary font-heading break-all">= {h.result}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
};

export default Calculator;