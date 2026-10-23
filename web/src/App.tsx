import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { AppLayout } from "./layout/AppLayout";
import { Carregando, EstadoVazio } from "./ui/componentes";
import { DefinirSenha, Login, Mfa, RecuperarSenha } from "./pages/Acesso";
import { Painel } from "./pages/Painel";
import { Colaboradores, NovoColaborador } from "./pages/Colaboradores";
import { Ficha } from "./pages/Ficha";
import { PaginaDocumentos } from "./pages/Documentos";
import { Acessos, Auditoria, Conta, Lojas } from "./pages/Admin";
import { Manual } from "./pages/Manual";

/** Exige login (e MFA quando o perfil pede). */
function Protegida({ children }: { children: ReactNode }) {
  const { carregando, sessao, mfa } = useAuth();
  const local = useLocation();
  if (carregando) return <Carregando />;
  if (!sessao) return <Navigate to="/login" replace state={{ de: local.pathname }} />;
  if (mfa !== "ok") return <Navigate to="/mfa" replace />;
  return <>{children}</>;
}

/** Bloqueia a tela para quem não tem a permissão (o banco bloqueia de novo). */
function Requer({ perm, children }: { perm: string | ((pode: (p: string) => boolean) => boolean); children: ReactNode }) {
  const { pode, permissoes } = useAuth();
  const ok = typeof perm === "string" ? pode(perm) : perm(pode);
  if (!ok) {
    return permissoes.length === 0
      ? <EstadoVazio titulo="Seu usuário ainda não tem acesso" descricao="Peça ao RH ou à diretoria para liberar o seu perfil." />
      : <EstadoVazio titulo="Você não tem acesso a esta área" />;
  }
  return <>{children}</>;
}

export function App() {
  const { permissoes } = useAuth();
  const leDocs = () => permissoes.some((x) => /^documento\.[a-z]+\.ler$/.test(x.permissao) && x.liberada_na_sessao);
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/recuperar-senha" element={<RecuperarSenha />} />
      <Route path="/definir-senha" element={<DefinirSenha />} />
      <Route path="/mfa" element={<Mfa />} />
      <Route element={<Protegida><AppLayout /></Protegida>}>
        <Route index element={<Requer perm={(p) => p("dashboard.ver") || p("colaborador.ler")}><Painel /></Requer>} />
        <Route path="colaboradores" element={<Requer perm="colaborador.ler"><Colaboradores /></Requer>} />
        <Route path="colaboradores/novo" element={<Requer perm="colaborador.criar"><NovoColaborador /></Requer>} />
        <Route path="colaboradores/:id" element={<Requer perm="colaborador.ler"><Ficha /></Requer>} />
        <Route path="documentos" element={<Requer perm={leDocs}><PaginaDocumentos /></Requer>} />
        <Route path="lojas" element={<Requer perm="config.estrutura.gerir"><Lojas /></Requer>} />
        <Route path="acessos" element={<Requer perm="acesso.gerir"><Acessos /></Requer>} />
        <Route path="auditoria" element={<Requer perm="auditoria.ler"><Auditoria /></Requer>} />
        <Route path="conta" element={<Conta />} />
        <Route path="manual" element={<Manual />} />
        <Route path="*" element={<EstadoVazio titulo="Página não encontrada" />} />
      </Route>
    </Routes>
  );
}
