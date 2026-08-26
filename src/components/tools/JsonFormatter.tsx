import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const JsonFormatter = () => {
  const [text, setText] = useState("");
  const format = () => { try { setText(JSON.stringify(JSON.parse(text), null, 2)); } catch (e) { toast.error("JSON inválido"); } };
  const minify = () => { try { setText(JSON.stringify(JSON.parse(text))); } catch (e) { toast.error("JSON inválido"); } };
  return (
    <div className="space-y-3">
      <Textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"foo": "bar"}' className="font-mono text-xs" />
      <div className="flex gap-2"><Button onClick={format}>Formatar</Button><Button variant="outline" onClick={minify}>Minificar</Button></div>
    </div>
  );
};
export default JsonFormatter;