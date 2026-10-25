import { detectarTipo, pdfSuspeito, nomeSeguro, nomeComExtensao } from "../_shared/comum.ts";
const enc = (s: string) => new TextEncoder().encode(s);
const casos: [string, Uint8Array, string | null][] = [
  ["pdf", enc("%PDF-1.7\n..."), "application/pdf"],
  ["jpeg", new Uint8Array([0xff,0xd8,0xff,0xe0,0,0]), "image/jpeg"],
  ["png", new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0]), "image/png"],
  ["webp", enc("RIFF\0\0\0\0WEBPVP8 "), "image/webp"],
  ["exe disfarçado de pdf", enc("MZ\x90\0"), null],
  ["html", enc("<html><script>"), null],
];
let falhas = 0;
for (const [n, b, esp] of casos) { const r = detectarTipo(b); if (r !== esp) { falhas++; console.log("FALHOU", n, r); } else console.log("ok -", n); }
if (!pdfSuspeito(enc("%PDF-1.4 /OpenAction << /JS (app.alert(1)) >>"))) { falhas++; console.log("FALHOU pdf com JS"); } else console.log("ok - pdf com JavaScript recusado");
if (pdfSuspeito(enc("%PDF-1.4 /Type /Page"))) { falhas++; console.log("FALHOU pdf normal"); } else console.log("ok - pdf normal aceito");
if (nomeSeguro("../../etc/passwd") !== ".._.._etc_passwd") { falhas++; console.log("FALHOU nome", nomeSeguro("../../etc/passwd")); } else console.log("ok - nome de arquivo sanitizado");
const ext: [string, string, string][] = [
  ["holerite.hta", "image/jpeg", "holerite.jpg"],
  ["Recibo\u202Egpj.hta", "image/png", "Recibo_gpj.png"],
  ["contrato.PDF", "application/pdf", "contrato.pdf"],
  ['a"b;c.html', "image/webp", "a_b_c.webp"],
  [".hta", "application/pdf", "arquivo.pdf"],
];
for (const [n, t, esp] of ext) { const r = nomeComExtensao(n, t); if (r !== esp) { falhas++; console.log("FALHOU extensão", n, r); } else console.log("ok - extensão do tipo real:", r); }
if (falhas) Deno.exit(1);
