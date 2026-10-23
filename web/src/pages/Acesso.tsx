import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { KeyRound, ShieldCheck } from "lucide-react";
import { supabase, mensagemErro } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { Aviso, Botao, Campo, Carregando } from "../ui/componentes";

function Moldura({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primaria font-display text-sm font-bold text-superficie" aria-hidden>RH</div>
          <h1 className="text-2xl font-semibold">{titulo}</h1>
          {subtitulo && <p className="mt-2 text-sm text-texto-suave">{subtitulo}</p>}
        </div>
        <div className="rounded-xl border border-borda bg-superficie p-6">{children}</div>
        <p className="mt-6 text-center text-xs text-texto-suave">Idealize RH 360º · Óticas Idealize</p>
      </div>
    </div>
  );
}

/* ---------------- Login ---------------- */
export function Login() {
  const { sessao, mfa, carregando } = useAuth();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (carregando) return <Carregando />;
  if (sessao) return <Navigate to={mfa === "ok" ? "/" : "/mfa"} replace />;

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro(null); setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEnviando(false);
    if (error) {
      // mensagem genérica: não revela se o e-mail existe
      setErro(/rate|too many/i.test(error.message)
        ? "Muitas tentativas. Aguarde alguns minutos e tente de novo."
        : "E-mail ou senha incorretos.");
    }
  }

  return (
    <Moldura titulo="Entrar" subtitulo="Gestão de Pessoas & Departamento Pessoal">
      <form onSubmit={entrar} className="flex flex-col gap-4" noValidate>
        <Campo rotulo="E-mail" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} obrigatorio />
        <Campo rotulo="Senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} obrigatorio />
        {erro && <Aviso tom="perigo">{erro}</Aviso>}
        <Botao type="submit" carregando={enviando} disabled={!email || !senha} icone={<KeyRound className="size-4" />}>Entrar</Botao>
        <Link to="/recuperar-senha" className="text-center text-sm text-primaria hover:underline">Esqueci minha senha</Link>
      </form>
    </Moldura>
  );
}

/* ---------------- Recuperar senha ---------------- */
export function RecuperarSenha() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/definir-senha` });
    setEnviando(false);
    setEnviado(true); // sempre a mesma resposta, exista ou não o e-mail
  }

  return (
    <Moldura titulo="Recuperar senha" subtitulo="Enviaremos um link para você criar uma nova senha.">
      {enviado ? (
        <div className="flex flex-col gap-4">
          <Aviso tom="sucesso">Se este e-mail estiver cadastrado, você vai receber o link em alguns minutos. Confira também o spam.</Aviso>
          <Link to="/login" className="text-center text-sm text-primaria hover:underline">Voltar para o login</Link>
        </div>
      ) : (
        <form onSubmit={enviar} className="flex flex-col gap-4">
          <Campo rotulo="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} obrigatorio />
          <Botao type="submit" carregando={enviando} disabled={!email}>Enviar link</Botao>
          <Link to="/login" className="text-center text-sm text-primaria hover:underline">Voltar para o login</Link>
        </form>
      )}
    </Moldura>
  );
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
          <Link to="/recuperar-senha" className="text-center text-sm text-primaria hover:underline">Pedir novo link</Link>
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
    navegar("/", { replace: true });
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
