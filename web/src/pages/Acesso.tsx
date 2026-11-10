import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { supabase, mensagemErro } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { CENTRAL, embutidoNoCentral } from "../lib/central";
import { Aviso, Botao, Campo, Carregando } from "../ui/componentes";

function Moldura({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/logo.png" alt="Óticas Idealize" width={600} height={182} className="mb-6 h-auto w-52 select-none" draggable={false} />
          <h1 className="text-2xl font-semibold">{titulo}</h1>
          {subtitulo && <p className="mt-2 text-sm text-texto-suave">{subtitulo}</p>}
        </div>
        <div className="rounded-xl border border-borda bg-superficie p-6">{children}</div>
        <p className="mt-6 text-center text-xs text-texto-suave">Idealize RH 360º · Gestão de Pessoas & Departamento Pessoal</p>
      </div>
    </div>
  );
}

/* ---------------- Login: agora é sempre pelo Central Idealize ---------------- */
function irParaCentral(caminho: string) {
  window.location.replace(`${CENTRAL}${caminho}`);
}

export function Login() {
  const { sessao, mfa, carregando } = useAuth();
  const [segundos, setSegundos] = useState(3);
  const fora = !embutidoNoCentral;

  useEffect(() => {
    if (carregando || sessao || !fora) return;
    if (segundos <= 0) { irParaCentral("/s/rh"); return; }
    const t = window.setTimeout(() => setSegundos((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [carregando, sessao, fora, segundos]);

  if (carregando) return <Carregando />;
  if (sessao) return <Navigate to={mfa === "ok" ? "/" : "/mfa"} replace />;

  // Dentro do Central e sem acesso recebido (ex.: sessão do Central encerrou)
  if (!fora) {
    return (
      <Moldura titulo="Idealize RH 360º" subtitulo="Não recebemos o seu acesso do Central.">
        <div className="flex flex-col gap-4">
          <Aviso tom="alerta">Recarregue a página do Central. Se continuar, saia e entre de novo no Central.</Aviso>
          <Botao onClick={() => window.location.reload()}>Tentar de novo</Botao>
        </div>
      </Moldura>
    );
  }

  return (
    <Moldura titulo="Idealize RH 360º" subtitulo="O acesso agora é pelo Central Idealize. Use o mesmo e-mail e senha de sempre.">
      <div className="flex flex-col gap-4">
        <Botao icone={<ArrowRight className="size-4" />} onClick={() => irParaCentral("/s/rh")}>Entrar pelo Central</Botao>
        <p className="text-center text-xs text-texto-suave" aria-live="polite">Redirecionando em {segundos} {segundos === 1 ? "segundo" : "segundos"}…</p>
      </div>
    </Moldura>
  );
}

/* ---------------- Recuperar senha: feito no Central ---------------- */
export function RecuperarSenha() {
  useEffect(() => { irParaCentral("/recuperar-senha"); }, []);
  return <Carregando />;
}

/* ---------------- Definir senha (convite ou recuperação) ---------------- */
export function DefinirSenha() {
  const { sessao, carregando } = useAuth();
  const navegar = useNavigate();
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (carregando) return <Carregando />;
  if (!sessao) {
    return (
      <Moldura titulo="Link inválido ou expirado">
        <div className="flex flex-col gap-4">
          <Aviso tom="alerta">Peça um novo link em “Esqueci minha senha” ou solicite um novo convite ao RH.</Aviso>
          <a href={`${CENTRAL}/recuperar-senha`} className="text-center text-sm text-primaria hover:underline">Pedir novo link</a>
        </div>
      </Moldura>
    );
  }

  const fraca = senha.length > 0 && (senha.length < 10 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (fraca) return setErro("Use pelo menos 10 caracteres, com letras e números.");
    if (senha !== confirma) return setErro("As senhas não conferem.");
    setEnviando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setEnviando(false);
    if (error) return setErro(mensagemErro(error));
    if (embutidoNoCentral) navegar("/", { replace: true }); else irParaCentral("/s/rh");
  }

  return (
    <Moldura titulo="Criar senha" subtitulo={sessao.user.email}>
      <form onSubmit={salvar} className="flex flex-col gap-4">
        <Campo rotulo="Nova senha" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)}
          dica="Mínimo de 10 caracteres, com letras e números." erro={fraca ? "Senha fraca" : null} obrigatorio />
        <Campo rotulo="Confirme a senha" type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} obrigatorio />
        {erro && <Aviso tom="perigo">{erro}</Aviso>}
        <Botao type="submit" carregando={enviando} disabled={!senha || !confirma}>Salvar senha</Botao>
      </form>
    </Moldura>
  );
}

/* ---------------- MFA (cadastro ou verificação) ---------------- */
export function Mfa() {
  const { sessao, mfa, carregando, recarregar, sair } = useAuth();
  const [fator, setFator] = useState<{ id: string; qr?: string; segredo?: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!sessao || mfa === "ok") return;
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verificado = data?.totp.find((f) => f.status === "verified");
      if (mfa === "verificar" && verificado) { setFator({ id: verificado.id }); return; }
      // remove tentativas de cadastro não concluídas antes de criar outra
      for (const f of data?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: novo, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Autenticador ${new Date().toLocaleDateString("pt-BR")}` });
      if (error) { setErro(mensagemErro(error)); return; }
      setFator({ id: novo.id, qr: novo.totp.qr_code, segredo: novo.totp.secret });
    })();
  }, [sessao, mfa]);

  if (carregando) return <Carregando />;
  if (!sessao) return <Navigate to="/login" replace />;
  if (mfa === "ok") return <Navigate to="/" replace />;

  async function verificar(e: FormEvent) {
    e.preventDefault();
    if (!fator) return;
    setErro(null); setEnviando(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fator.id, code: codigo.trim() });
    setEnviando(false);
    if (error) { setErro("Código inválido ou expirado. Confira o horário do celular e tente de novo."); return; }
    await recarregar();
  }

  const cadastrando = mfa === "cadastrar";
  return (
    <Moldura
      titulo={cadastrando ? "Ative a verificação em duas etapas" : "Verificação em duas etapas"}
      subtitulo={cadastrando
        ? "Seu perfil acessa dados sensíveis. Use um app autenticador (Google Authenticator, Microsoft Authenticator ou similar)."
        : "Digite o código de 6 dígitos do seu app autenticador."}>
      <form onSubmit={verificar} className="flex flex-col gap-4">
        {cadastrando && !fator && !erro && <Carregando texto="Gerando QR code…" />}
        {cadastrando && fator?.qr && (
          <div className="flex flex-col items-center gap-3">
            <img src={fator.qr} alt="QR code para o app autenticador" className="size-48 rounded-lg border border-borda bg-superficie p-2" />
            <details className="w-full text-sm">
              <summary className="cursor-pointer text-primaria">Não consigo ler o QR code</summary>
              <p className="mt-2 break-all rounded-lg bg-fundo p-2 font-mono text-xs">{fator.segredo}</p>
            </details>
          </div>
        )}
        <Campo rotulo="Código" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} obrigatorio />
        {erro && <Aviso tom="perigo">{erro}</Aviso>}
        <Botao type="submit" carregando={enviando} disabled={codigo.length !== 6 || !fator} icone={<ShieldCheck className="size-4" />}>
          {cadastrando ? "Ativar e entrar" : "Verificar"}
        </Botao>
        <button type="button" onClick={sair} className="text-center text-sm text-texto-suave hover:underline">Sair</button>
      </form>
    </Moldura>
  );
}
