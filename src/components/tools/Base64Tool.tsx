import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const MAX_LEN = 5 * 1024 * 1024; // 5 MB de texto

const Base64Tool = () => {
  const [text, setText] = useState("");
  const guard = () => {
    if (text.length > MAX_LEN) { toast.error("Texto muito grande (máx. 5 MB)"); return false; }
    return true;
  };
  const enc = () => { if (!guard()) return; try { setText(btoa(unescape(encodeURIComponent(text)))); } catch { toast.error("Falha"); } };
  const dec = () => { if (!guard()) return; try { setText(decodeURIComponent(escape(atob(text)))); } catch { toast.error("Base64 inválido"); } };
  return (
    <div className="space-y-3">
      <Label>Texto / Base64</Label>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} />
      <div className="flex gap-2">
        <Button onClick={enc}>Codificar</Button>
        <Button variant="outline" onClick={dec}>Decodificar</Button>
      </div>
    </div>
  );
};
export default Base64Tool;