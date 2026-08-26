import { useState } from "react";
import QRCode from "qrcode";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { downloadBlob } from "@/lib/download";

const QrGenerator = () => {
  const [text, setText] = useState("https://matheusmarx.com.br");
  const [ecLevel, setEcLevel] = useState<"L" | "M" | "Q" | "H">("M");
  const [fg, setFg] = useState("#000000");
  const [bg, setBg] = useState("#ffffff");
  const [url, setUrl] = useState("");
  const go = async () => {
    const dataUrl = await QRCode.toDataURL(text, {
      width: 512, margin: 1,
      errorCorrectionLevel: ecLevel,
      color: { dark: fg, light: bg },
    });
    setUrl(dataUrl);
  };
  const save = async () => {
    if (!url) return;
    const blob = await (await fetch(url)).blob();
    downloadBlob(blob, "qrcode.png");
  };
  return (
    <div className="space-y-3">
      <Label>Texto / URL</Label>
      <Input value={text} onChange={(e) => setText(e.target.value)} />
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Correção</Label>
          <Select value={ecLevel} onValueChange={(v) => setEcLevel(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="L">L — 7%</SelectItem>
              <SelectItem value="M">M — 15%</SelectItem>
              <SelectItem value="Q">Q — 25%</SelectItem>
              <SelectItem value="H">H — 30%</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Cor</Label>
          <Input type="color" value={fg} onChange={(e) => setFg(e.target.value)} className="h-10 p-1" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Fundo</Label>
          <Input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="h-10 p-1" />
        </div>
      </div>
      <div className="flex gap-2"><Button onClick={go}>Gerar QR</Button>{url && <Button variant="outline" onClick={save}>Baixar PNG</Button>}</div>
      {url && <img src={url} alt="QR" className="w-64 h-64 bg-white p-2 rounded" />}
    </div>
  );
};
export default QrGenerator;