// Robô do banco de horas — Idealize RH 360º
// 1) Entra no SuperPortal da VR (usuário + senha + código que chega no Gmail)
// 2) Abre o RH Digital (Pontomais) e gera o relatório "Banco de horas" dos últimos dias
// 3) Envia as linhas para o RH 360 (public.banco_horas_receber)
//
// IMPORTANTE: o repositório é público, então o log NUNCA mostra nomes, saldos, e-mails ou códigos.
// Variáveis (segredos do GitHub): VR_USUARIO, VR_SENHA, GMAIL_USUARIO, GMAIL_SENHA_APP, RH_ROBO_CHAVE
// Variáveis públicas: RH_SUPABASE_URL, RH_SUPABASE_CHAVE_PUBLICA
import { chromium } from "playwright";
import { ImapFlow } from "imapflow";
import { parse } from "node-html-parser";

const env = (k) => { const v = process.env[k]; if (!v) throw new Erro(`Falta a configuração ${k}`); return v; };
class Erro extends Error {}

const DIAS = Number(process.env.DIAS ?? 35);
const PORTAL = "https://superportal-empregador.vr.com.br";
const API = "https://api.pontomais.com.br";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => d.toISOString().slice(0, 10);

/* ---------------- Gmail: busca o código de acesso da VR ---------------- */
async function codigoDoGmail(desde) {
  const imap = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true, logger: false,
    auth: { user: env("GMAIL_USUARIO"), pass: env("GMAIL_SENHA_APP").replace(/\s/g, "") },
  });
  await imap.connect();
  try {
    for (let tentativa = 0; tentativa < 24; tentativa++) {          // até ~4 minutos
      const lock = await imap.getMailboxLock("INBOX");
      try {
        const ids = await imap.search({ since: new Date(desde.getTime() - 24 * 3600e3) }, { uid: true });
        const recentes = (ids || []).slice(-15).reverse();
        for (const uid of recentes) {
          const m = await imap.fetchOne(uid, { envelope: true, source: true, internalDate: true }, { uid: true });
          if (!m || new Date(m.internalDate) < new Date(desde.getTime() - 60e3)) continue;
          const de = (m.envelope?.from || []).map((f) => `${f.address}`).join(" ").toLowerCase();
          const assunto = (m.envelope?.subject || "").toLowerCase();
          if (!/vr\.com\.br|vr benef|auth0|vr\b/.test(de + " " + assunto)) continue;
          const corpo = m.source.toString("utf8")
            .replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
            .replace(/<[^>]+>/g, " ");
          const achou = (assunto.match(/\b(\d{6})\b/) || corpo.match(/(?:c[óo]digo|code)[^0-9]{0,80}(\d{6})\b/i) || corpo.match(/\b(\d{6})\b/));
          if (achou) return achou[1];
        }
      } finally { lock.release(); }
      await espera(10_000);
    }
  } finally { await imap.logout().catch(() => {}); }
  throw new Erro("O código de acesso da VR não chegou no Gmail em 4 minutos");
}

/* ---------------- Login no SuperPortal ---------------- */
async function entrar(page) {
  await page.goto(PORTAL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const usuario = page.locator('input[name="username"]');
  await usuario.waitFor({ timeout: 60_000 }).catch(async () => {
    const titulo = await page.title().catch(() => "");
    throw new Erro(`A página de login da VR não abriu (${titulo || "sem título"}) — possível bloqueio de robô`);
  });
  await usuario.fill(env("VR_USUARIO"));
  const senha = page.locator('input[name="password"]');
  if (!(await senha.isVisible().catch(() => false))) {
    await page.locator('button[type="submit"]').first().click();
    await senha.waitFor({ timeout: 30_000 });
  }
  await senha.fill(env("VR_SENHA"));
  const antes = new Date();
  await page.locator('button[type="submit"][name="action"], button[type="submit"]').first().click();
  log("usuário e senha enviados");

  // ou cai direto no portal, ou pede o código
  const campoCodigo = page.locator('input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"]').first();
  const resultado = await Promise.race([
    page.waitForURL(/superportal-empregador\.vr\.com\.br/, { timeout: 90_000 }).then(() => "portal"),
    campoCodigo.waitFor({ timeout: 90_000 }).then(() => "codigo"),
  ]).catch(() => "nada");
  if (resultado === "nada") {
    const erroTela = await page.locator('[id*="error"], .ulp-input-error-message, [role="alert"]').first().innerText().catch(() => "");
    throw new Erro(`Login não avançou${erroTela ? `: ${erroTela.slice(0, 120)}` : " (usuário/senha ou bloqueio)"}`);
  }
  if (resultado === "codigo") {
    log("VR pediu código; lendo o Gmail");
    const codigo = await codigoDoGmail(antes);
    await campoCodigo.fill(codigo);
    const lembrar = page.locator('input[type="checkbox"][name*="remember" i]');
    if (await lembrar.isVisible().catch(() => false)) await lembrar.check().catch(() => {});
    await page.locator('button[type="submit"][name="action"], button[type="submit"]').first().click();
    await page.waitForURL(/superportal-empregador\.vr\.com\.br/, { timeout: 90_000 })
      .catch(() => { throw new Erro("O código foi digitado, mas o portal não abriu"); });
  }
  log("logado no SuperPortal");
}

/* ---------------- Cabeçalhos da sessão Pontomais (capturados da própria página) ---------------- */
async function sessaoPontomais(page) {
  const NOMES = ["access-token", "client", "uid", "uuid", "token", "api-version"];
  const capturado = new Promise((resolve) => {
    page.on("request", (req) => {
      if (!req.url().startsWith(API)) return;
      const h = req.headers();
      if (h["access-token"] && h["client"] && h["uid"]) {
        resolve(Object.fromEntries(NOMES.filter((n) => h[n]).map((n) => [n, h[n]])));
      }
    });
  });
  await page.goto(`${PORTAL}/pontomais/visao-geral`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const h = await Promise.race([capturado, espera(120_000).then(() => null)]);
  if (!h) throw new Erro("Não consegui abrir o RH Digital (Pontomais) dentro do portal");
  log("sessão do RH Digital capturada");
  return h;
}

/* chamadas à API do Pontomais feitas de dentro da página (mesma origem/cookies do navegador) */
async function api(page, cab, metodo, caminho, corpo) {
  return page.evaluate(async ({ url, metodo, cab, corpo }) => {
    const r = await fetch(url, {
      method: metodo,
      headers: { ...cab, "Content-Type": "application/json", Accept: "application/json, text/plain, */*" },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const t = await r.text();
    return { status: r.status, texto: t };
  }, { url: caminho.startsWith("http") ? caminho : `${API}${caminho}`, metodo, cab, corpo });
}

/* pede um relatório HTML ao Pontomais, espera ficar pronto e baixa */
async function relatorioHtml(page, cab, tipo, report) {
  const r = await api(page, cab, "POST", `/api/html_reports/${tipo}`, { report: {
    report_id: tipo, row_filters: "", additional_row_filters: "", proposal_status: "", format: "html",
    fabrication_number: "", initial_nsr: "", group_columns: "", ...report } });
  if (r.status >= 400) return { recusado: r.status };
  const job = JSON.parse(r.texto).job_id;
  if (!job) throw new Erro("O Pontomais não devolveu o número do relatório");
  for (let i = 0; i < 60; i++) {
    await espera(3000);
    const j = await api(page, cab, "GET", `/api/users/jobs/${job}`);
    const dados = JSON.parse(j.texto).job;
    if (dados?.has_err) throw new Erro(`O Pontomais falhou ao gerar o relatório: ${String(dados.err_msg || "").slice(0, 120)}`);
    const url = dados?.result?.report_url;
    if (dados?.status?.id === 3 && url) {
      const html = await api(page, cab, "GET", url.startsWith("//") ? `https:${url}` : url);
      if (html.status >= 400) throw new Erro(`Não consegui baixar o relatório (${html.status})`);
      return { html: html.texto };
    }
  }
  throw new Erro("O relatório do Pontomais demorou demais");
}

async function gerarBancoHoras(page, cab, inicio, fim) {
  const base = "date,name,time_balance_resume,time_balance,overtime_missing_hours,extra_time";
  for (const columns of [`${base},registration_number,department`, base]) {
    const r = await relatorioHtml(page, cab, "time_balances", { start_date: inicio, end_date: fim, columns, row_filters: "has_time_balance" });
    if (r.html) return r.html;
    log(`banco de horas recusado (${r.recusado}); tentando com as colunas padrão`);
  }
  throw new Erro("O Pontomais recusou o pedido do relatório de banco de horas");
}

async function gerarPendencias(page, cab, inicio, fim) {
  const r = await relatorioHtml(page, cab, "pendencies", { start_date: inicio, end_date: fim,
    columns: "date,employee_name,pendencies,status",
    additional_row_filters: "allowance,proposal,unjustified_missing_day,wrong_number_of_time_cards" });
  if (!r.html) { log(`relatório de pendências recusado (${r.recusado}); seguindo só com o banco de horas`); return null; }
  return r.html;
}

/* ---------------- Leitura do HTML do relatório ---------------- */
const minutos = (t) => {
  const m = String(t || "").trim().match(/^(-)?\s*(\d+):(\d{2})$/);
  return m ? (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
};
const dataISO = (t) => { const m = String(t || "").match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

/* tabela com cabeçalho "Nome | Data | Pendência | Status" */
export function lerPendencias(html) {
  const doc = parse(html); const lista = [];
  for (const tabela of doc.querySelectorAll("table")) {
    let col = null;
    for (const tr of tabela.querySelectorAll("tr")) {
      const cel = tr.querySelectorAll("th,td").map((c) => c.text.replace(/\s+/g, " ").trim());
      if (!col) {
        const nome = cel.findIndex((c) => /^nome$/i.test(c)), data = cel.findIndex((c) => /^data$/i.test(c)), pend = cel.findIndex((c) => /^pend[eê]ncia/i.test(c));
        if (nome >= 0 && data >= 0 && pend >= 0) col = { nome, data, pend, status: cel.findIndex((c) => /^status$/i.test(c)) };
        continue;
      }
      const data = dataISO(cel[col.data]);
      if (!data || !cel[col.nome] || !cel[col.pend]) continue;
      lista.push({ nome: cel[col.nome], data, pendencia: cel[col.pend], status: col.status >= 0 ? cel[col.status] : null });
    }
  }
  return lista;
}

export function lerRelatorio(html) {
  const doc = parse(html);
  const linhas = [];
  for (const tabela of doc.querySelectorAll("table")) {
    const trs = tabela.querySelectorAll("tr");
    let col = null;
    for (const tr of trs) {
      const cel = tr.querySelectorAll("th,td").map((c) => c.text.replace(/\s+/g, " ").trim());
      if (!col) {
        const iNome = cel.findIndex((c) => /^nome$/i.test(c)), iData = cel.findIndex((c) => /^data$/i.test(c));
        if (iNome >= 0 && iData >= 0) {
          const idx = (re) => cel.findIndex((c) => re.test(c));
          col = { nome: iNome, data: iData, mat: idx(/matr/i), dep: idx(/departamento/i),
            he50: idx(/50%/), he100: idx(/100%/), pos: idx(/horas positivas/i), neg: idx(/horas negativas/i), saldo: idx(/^saldo bh$/i) };
        }
        continue;
      }
      if (cel.length < 4) continue;
      const data = dataISO(cel[col.data]); const saldo = minutos(cel[col.saldo]);
      if (!data || saldo === null || !cel[col.nome]) continue;
      linhas.push({
        nome: cel[col.nome], data, saldo_min: saldo,
        matricula: col.mat >= 0 ? cel[col.mat] : null, departamento: col.dep >= 0 ? cel[col.dep] : null,
        positivas_min: minutos(cel[col.pos]) ?? 0, negativas_min: minutos(cel[col.neg]) ?? 0,
        he50_min: minutos(cel[col.he50]) ?? 0, he100_min: minutos(cel[col.he100]) ?? 0,
      });
    }
  }
  return linhas;
}

/* ---------------- Envio para o RH 360 ---------------- */
async function enviar(execucao, linhas, pendencias = null) {
  const r = await fetch(`${env("RH_SUPABASE_URL")}/rest/v1/rpc/banco_horas_receber`, {
    method: "POST",
    headers: { apikey: env("RH_SUPABASE_CHAVE_PUBLICA"), "Content-Type": "application/json" },
    body: JSON.stringify({ p_chave: env("RH_ROBO_CHAVE"), p_execucao: execucao, p_linhas: linhas, p_pendencias: pendencias }),
  });
  if (!r.ok) throw new Error(`RH 360 recusou o envio (${r.status})`);
  return r.json();
}

/* ---------------- Principal ---------------- */
async function principal() {
  const fim = new Date(); const inicio = new Date(fim.getTime() - DIAS * 86400e3);
  const periodo = { periodo_inicio: iso(inicio), periodo_fim: iso(fim) };
  const navegador = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
  try {
    const ctx = await navegador.newContext({
      locale: "pt-BR", timezoneId: "America/Sao_Paulo", viewport: { width: 1366, height: 900 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    });
    const page = await ctx.newPage();
    await entrar(page);
    const cab = await sessaoPontomais(page);
    const linhas = lerRelatorio(await gerarBancoHoras(page, cab, periodo.periodo_inicio, periodo.periodo_fim));
    if (!linhas.length) throw new Erro("O relatório de banco de horas veio sem linhas (layout mudou?)");
    log(`banco de horas lido: ${linhas.length} linhas, ${new Set(linhas.map((l) => l.nome)).size} pessoas`);
    const htmlPend = await gerarPendencias(page, cab, periodo.periodo_inicio, periodo.periodo_fim);
    const pendencias = htmlPend ? lerPendencias(htmlPend) : null;
    if (pendencias) log(`pendências lidas: ${pendencias.length}`);
    const r = await enviar({ status: "ok", ...periodo }, linhas, pendencias);
    log(`enviado ao RH 360: ${r.linhas} linhas, ${r.pessoas} pessoas`);
  } catch (e) {
    const msg = e instanceof Erro ? e.message : `Erro inesperado: ${String(e?.message || e).split("\n")[0].slice(0, 200)}`;
    log(`FALHOU: ${msg}`);
    await enviar({ status: "erro", mensagem: msg, ...periodo }, []).catch(() => log("também não consegui avisar o RH 360"));
    process.exitCode = 1;
  } finally {
    await navegador.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) principal();
