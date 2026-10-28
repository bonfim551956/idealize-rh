import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Archive, BookOpen, Bus, CheckCircle2, ClipboardList, FileText, HelpCircle, KeyRound, Laptop, LayoutDashboard, Lock, Printer, ScrollText,
  Search, ShieldCheck, Shirt, Sparkles, Store, UserCog, UserMinus, UserPlus, Users, Wallet, type LucideIcon,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useLojas } from "../lib/dados";
import { SIGILO } from "../lib/formato";
import { Aviso, Botao, CabecalhoPagina, Campo, Selo, cx } from "../ui/componentes";

/* =====================================================================
   Manual do usuário — o conteúdo é montado de acordo com as permissões
   de quem está logado. Cada seção declara quando aparece (`mostrar`).
   Ao criar uma funcionalidade nova, acrescente a seção aqui.
   ===================================================================== */

type Ctx = {
  pode: (p: string) => boolean;
  leDoc: (nivel: string) => boolean;
  enviaDoc: (nivel: string) => boolean;
  leAlgumDoc: boolean;
  enviaAlgumDoc: boolean;
  niveisLeitura: string[];
  niveisEnvio: string[];
  /** a permissão vale para todas as lojas (não só algumas) */
  todasLojas: (p: string) => boolean;
};

type Secao = {
  id: string;
  titulo: string;
  icone: LucideIcon;
  grupo: "Começando" | "Pessoas" | "Documentos" | "Uniformes" | "VT e ausências" | "Administração" | "Referência";
  palavras: string;
  mostrar: (c: Ctx) => boolean;
  conteudo: (c: Ctx) => ReactNode;
};

/* ---------------- Blocos de texto ---------------- */
const P = ({ children }: { children: ReactNode }) => <p className="mb-3 text-sm leading-relaxed">{children}</p>;
const T = ({ children }: { children: ReactNode }) => <h3 className="mb-2 mt-6 text-base font-semibold first:mt-0">{children}</h3>;
const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold">{children}</strong>;
function Passos({ itens }: { itens: ReactNode[] }) {
  return (
    <ol className="mb-4 flex flex-col gap-2">
      {itens.map((t, i) => (
        <li key={i} className="flex gap-3 text-sm leading-relaxed">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primaria-suave text-xs font-semibold text-primaria">{i + 1}</span>
          <span className="pt-0.5">{t}</span>
        </li>
      ))}
    </ol>
  );
}
function Lista({ itens }: { itens: ReactNode[] }) {
  return <ul className="mb-4 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed marker:text-marca">{itens.map((t, i) => <li key={i}>{t}</li>)}</ul>;
}
function Quadro({ cabecalho, linhas }: { cabecalho: string[]; linhas: ReactNode[][] }) {
  return (
    <div className="mb-4 overflow-x-auto rounded-lg border border-borda">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="bg-fundo text-xs uppercase tracking-wide text-texto-suave">
          <tr>{cabecalho.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-borda">
          {linhas.map((l, i) => <tr key={i}>{l.map((c, j) => <td key={j} className="px-3 py-2 align-top">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
const Dica = ({ children }: { children: ReactNode }) => <div className="mb-4"><Aviso tom="info">{children}</Aviso></div>;
const Atencao = ({ children }: { children: ReactNode }) => <div className="mb-4"><Aviso tom="alerta">{children}</Aviso></div>;
const Menu = ({ children }: { children: ReactNode }) => <span className="rounded bg-fundo px-1.5 py-0.5 font-medium text-texto">{children}</span>;

const NIVEIS_DESC: Record<string, string> = {
  geral: "Treinamentos, comunicação interna, jornada e ponto, saúde e segurança do trabalho (treinamentos de NR, EPI).",
  pessoal: "Documentos pessoais (RG, comprovantes), avaliações e outros documentos autorizados.",
  contratual: "Admissão, contratos, aditivos, férias, desligamento e obrigações trabalhistas.",
  saude: "Exames ocupacionais (ASO), atestados, afastamentos e licenças. Dado sensível pela LGPD.",
  financeiro: "Holerites, comprovantes de pagamento e documentos financeiros.",
  disciplinar: "Advertências e ocorrências.",
  juridico: "Documentos jurídicos.",
};

/* =====================================================================
   Seções
   ===================================================================== */
const SECOES: Secao[] = [
  /* ---------------- Começando ---------------- */
  {
    id: "acesso", titulo: "Entrar, senha e verificação em duas etapas", icone: KeyRound, grupo: "Começando",
    palavras: "login entrar senha esqueci recuperar convite mfa duas etapas autenticador qr code código celular trocar senha",
    mostrar: () => true,
    conteudo: () => (
      <>
        <T>Primeiro acesso (convite)</T>
        <Passos itens={[
          <>Você recebe um e-mail de convite do sistema. Clique no link — ele vale por tempo limitado.</>,
          <>Crie sua senha: <B>mínimo de 10 caracteres, com letras e números</B>. Não reutilize senhas de outros sites.</>,
          <>Se a sua conta exigir a <B>verificação em duas etapas</B>, o sistema pede para ativá-la (próximo tópico).</>,
        ]} />
        <T>Entrar no dia a dia</T>
        <Passos itens={[
          <>Acesse <B>rh.oticasidealize.online</B>, informe e-mail e senha e clique em <Menu>Entrar</Menu>.</>,
          <>Se tiver verificação em duas etapas, digite o código de 6 dígitos do app autenticador.</>,
        ]} />
        <T>Verificação em duas etapas (app autenticador)</T>
        <P>Ela é exigida por conta: quem administra os acessos define, em <Menu>Usuários e acessos</Menu>, quem precisa do autenticador. Quando a sua conta exige, as partes sensíveis (salários, dados pessoais completos, documentos de saúde, financeiros ou disciplinares, gestão de acessos) só liberam depois do código.</P>
        <Passos itens={[
          <>Instale no celular o <B>Google Authenticator</B> ou o <B>Microsoft Authenticator</B> (gratuitos).</>,
          <>No app, toque em <Menu>+</Menu> e escolha <Menu>Ler código QR</Menu>. Aponte para o QR code que aparece na tela do sistema.</>,
          <>Digite o código de 6 dígitos que o app mostrar e confirme. Pronto: a cada login o sistema vai pedir um código novo.</>,
        ]} />
        <Dica>Código recusado? Confira se o horário do celular está automático (Ajustes → Data e hora). O código muda a cada 30 segundos.</Dica>
        <Atencao>Trocou ou perdeu o celular? Avise imediatamente quem administra os acessos para redefinir sua verificação.</Atencao>
        <T>Esqueci minha senha</T>
        <Passos itens={[
          <>Na tela de login, clique em <Menu>Esqueci minha senha</Menu> e informe seu e-mail.</>,
          <>Abra o e-mail recebido (confira o spam) e clique no link.</>,
          <>Crie a nova senha. Por segurança, o sistema mostra a mesma mensagem exista ou não o e-mail.</>,
        ]} />
        <T>Sair e sessão</T>
        <Lista itens={[
          <>Para sair, use <Menu>Sair</Menu> no rodapé do menu (no celular, abra o menu ☰).</>,
          <>A sessão termina sozinha após <B>20 minutos sem uso</B>. É só entrar de novo.</>,
          <>Em <Menu>Minha conta</Menu> você troca a senha, vê o status da verificação em duas etapas e pode <B>sair de todos os dispositivos</B> (use se esqueceu o sistema aberto em outro computador).</>,
        ]} />
      </>
    ),
  },
  {
    id: "seu-acesso", titulo: "O que o seu acesso permite", icone: ShieldCheck, grupo: "Começando",
    palavras: "perfil permissão acesso loja escopo menu não aparece bloqueado",
    mostrar: () => true,
    conteudo: () => <SeuAcesso />,
  },
  {
    id: "navegacao", titulo: "Como o sistema é organizado", icone: BookOpen, grupo: "Começando",
    palavras: "menu navegação celular telas mensagens carregando erro",
    mostrar: () => true,
    conteudo: (c) => (
      <>
        <P>O menu à esquerda (no celular, no botão ☰ do topo) mostra só as áreas que o seu perfil pode usar:</P>
        <Lista itens={[
          (c.pode("dashboard.ver") || c.pode("colaborador.ler")) && <><B>Painel</B> — indicadores reais das suas lojas.</>,
          c.pode("colaborador.ler") && <><B>Colaboradores</B> — lista, cadastro e ficha de cada profissional.</>,
          c.leAlgumDoc && <><B>Documentos</B> — todos os documentos que você pode ver, com filtros.</>,
          c.pode("uniforme.ler") && <><B>Uniformes</B> — estoque central, entregas aos colaboradores e pedido de compra.</>,
          c.pode("config.estrutura.gerir") && <><B>Lojas e estrutura</B> — unidades e cargos.</>,
          c.pode("acesso.gerir") && <><B>Usuários e acessos</B> — convites e perfis.</>,
          c.pode("auditoria.ler") && <><B>Auditoria</B> — registro de tudo o que foi feito.</>,
          <><B>Minha conta</B> — senha, verificação em duas etapas e sessões.</>,
          <><B>Manual</B> — esta página.</>,
        ].filter(Boolean) as ReactNode[]} />
        <T>Mensagens do sistema</T>
        <Lista itens={[
          <>Faixa <span className="text-sucesso">verde</span> no canto da tela: a operação deu certo.</>,
          <>Faixa <span className="text-perigo">vermelha</span>: algo não foi salvo — leia a mensagem, ela diz o motivo (ex.: “Informe o motivo”).</>,
          <>“Você não tem permissão para esta ação”: o seu perfil não cobre aquilo. Fale com quem administra os acessos.</>,
          <>Campos com <span className="text-perigo">*</span> são obrigatórios.</>,
          <><B>Tudo o que você digita é gravado em LETRA MAIÚSCULA</B> (nomes, endereços, motivos, observações). Pode digitar normalmente: o sistema converte sozinho. A única exceção é o e-mail de login.</>,
        ]} />
        <Dica>O sistema guarda tudo na nuvem: atualizar a página ou trocar de computador não perde nada que já foi salvo.</Dica>
      </>
    ),
  },

  /* ---------------- Pessoas ---------------- */
  {
    id: "painel", titulo: "Painel de indicadores", icone: LayoutDashboard, grupo: "Pessoas",
    palavras: "painel dashboard indicadores números ativos admissões desligamentos documentos vencidos loja filtro avisos experiência férias vencer aniversário aniversariantes",
    mostrar: (c) => c.pode("dashboard.ver") || c.pode("colaborador.ler"),
    conteudo: () => (
      <>
        <P>O Painel mostra números <B>reais</B>, calculados na hora a partir do cadastro — nada é digitado à mão. Você só vê os números das lojas do seu acesso.</P>
        <Quadro cabecalho={["Indicador", "O que conta"]} linhas={[
          ["Colaboradores ativos", "Vínculos ativos, em férias, afastados ou em licença."],
          ["Admissões / Desligamentos (12 meses)", "Datas de admissão e de desligamento nos últimos 12 meses."],
          ["Tarefas abertas", "Pendências em aberto da central de tarefas (a tela de tarefas chega na próxima etapa)."],
          ["Documentos a conferir", "Documentos enviados que ainda não foram aprovados nem reprovados."],
          ["Aguardando assinatura", "Documentos marcados como pendentes de assinatura."],
          ["Vencem em 30 dias / Vencidos", "Documentos com data de vencimento (ex.: ASO) próxima ou passada."],
          ["Ativos por loja / Vínculos por status", "Distribuição da equipe."],
        ]} />
        <T>Avisos</T>
        <Quadro cabecalho={["Aviso", "Quando aparece"]} linhas={[
          ["Período de experiência", "Contrato de experiência cujo 1º período ou prorrogação termina nos próximos 7 dias, pela regra do cargo: 15 + 15 dias (consultores: 15 + 30). Decida antes: prorrogar, efetivar ou encerrar. Se o prazo já passou e o cadastro continua como experiência, aparece “Atualizar contrato”: abra a ficha e use Ações → Efetivar contrato."],
          ["Férias a vencer", "Período aquisitivo completo com saldo de férias e prazo (período concessivo) terminando nos próximos 90 dias. “Sair até” é o último dia para começar o saldo sem pagar em dobro. Conta as férias gozadas e programadas registradas na linha do tempo."],
          ["Aniversariantes", "Aniversários dos próximos 30 dias. Mostra só o dia e o mês (sem idade)."],
        ]} />
        <P>Use o seletor <Menu>Loja</Menu> no topo para ver uma unidade específica (aparece se você tem acesso a mais de uma).</P>
        <Dica>Painel vazio? Ainda não há colaboradores cadastrados nas suas lojas. O próprio painel mostra o atalho para começar.</Dica>
      </>
    ),
  },
  {
    id: "colaboradores", titulo: "Encontrar colaboradores", icone: Users, grupo: "Pessoas",
    palavras: "lista buscar pesquisar filtro loja situação cpf mascarado matrícula status",
    mostrar: (c) => c.pode("colaborador.ler"),
    conteudo: () => (
      <>
        <Passos itens={[
          <>Abra <Menu>Colaboradores</Menu> no menu.</>,
          <>Digite no campo <Menu>Buscar</Menu> parte do nome, nome social, matrícula ou cargo. Acentos não importam.</>,
          <>Filtre por <Menu>Loja</Menu> e por <Menu>Situação</Menu>. O padrão é <B>Vínculos vigentes</B> (esconde desligados e arquivados) — escolha <B>Todos</B> para ver o histórico completo.</>,
          <>Clique no nome para abrir a <B>ficha</B>.</>,
        ]} />
        <T>Situações do vínculo</T>
        <Quadro cabecalho={["Situação", "Significado"]} linhas={[
          [<Selo tom="info">Pré-admissão</Selo>, "Contratação em andamento; ainda não começou a trabalhar."],
          [<Selo tom="info">Em admissão</Selo>, "Documentos e procedimentos de admissão em curso."],
          [<Selo tom="sucesso">Ativo</Selo>, "Trabalhando normalmente."],
          [<Selo>Em férias</Selo>, "Em gozo de férias."],
          [<Selo tom="alerta">Afastado</Selo>, "Afastamento (ex.: atestado, INSS)."],
          [<Selo tom="alerta">Em licença</Selo>, "Licença (ex.: maternidade/paternidade)."],
          [<Selo tom="perigo">Em desligamento</Selo>, "Processo de desligamento aberto, ainda não concluído."],
          [<Selo>Desligado</Selo>, "Vínculo encerrado. O cadastro e os documentos continuam guardados."],
          [<Selo>Arquivado</Selo>, "Registro encerrado e arquivado (ex.: contratação desistida)."],
        ]} />
        <Dica>Na lista o CPF aparece mascarado (***.123.456-**). O CPF completo só aparece para perfis autorizados, na aba Dados pessoais, e cada visualização é registrada.</Dica>
      </>
    ),
  },
  {
    id: "cadastrar", titulo: "Cadastrar colaborador", icone: UserPlus, grupo: "Pessoas",
    palavras: "novo cadastro cadastrar admissão pré-admissão contratado matrícula cpf tipo vínculo jornada escala salário",
    mostrar: (c) => c.pode("colaborador.criar"),
    conteudo: (c) => (
      <>
        <Passos itens={[
          <>Em <Menu>Colaboradores</Menu>, clique em <Menu>Novo colaborador</Menu>.</>,
          <><B>Dados pessoais</B>: nome completo e CPF são obrigatórios. Nome social só se a pessoa usar. Endereço e contato de emergência podem ser preenchidos depois, na ficha.</>,
          <><B>Vínculo</B>: escolha a loja, a matrícula, o tipo de vínculo e a situação inicial (veja abaixo).</>,
          <>Preencha cargo, jornada semanal e escala.{c.pode("remuneracao.gerir") && <> Se for o caso, informe o <B>salário contratual</B>.</>}</>,
          <>Clique em <Menu>Cadastrar</Menu>. O sistema abre a ficha do colaborador recém-criado.</>,
        ]} />
        <T>Situação inicial: qual escolher?</T>
        <Quadro cabecalho={["Opção", "Quando usar", "Data de admissão"]} linhas={[
          [<B>Já contratado (ativo)</B>, "Para cadastrar quem já trabalha na empresa (carga inicial da equipe).", "Obrigatória, não pode ser futura."],
          [<B>Pré-admissão</B>, "Para quem ainda vai começar.", "Opcional (prevista)."],
        ]} />
        <T>Regras que o sistema confere</T>
        <Lista itens={[
          <>CPF precisa ser válido e não pode estar cadastrado em outra pessoa.</>,
          <>A matrícula não pode se repetir dentro da mesma empresa (CNPJ).</>,
          <>A loja define a <B>empresa empregadora</B> (CNPJ) do vínculo — confira a loja antes de salvar.</>,
          <>Jornada semanal: de 1 a 44 horas.</>,
          c.pode("remuneracao.gerir") && <>O salário só fica visível para perfis com permissão de remuneração.</>,
        ].filter(Boolean) as ReactNode[]} />
        <Atencao>Readmissão (pessoa que já trabalhou e volta): o CPF já existe, então o cadastro novo é recusado. O fluxo de readmissão chega na próxima etapa — até lá, fale com a diretoria.</Atencao>
        <Dica>Colete só os dados necessários. Não registre informações de saúde, religião ou vida pessoal em campos de texto livre.</Dica>
      </>
    ),
  },
  {
    id: "ficha", titulo: "Ficha do colaborador", icone: ClipboardList, grupo: "Pessoas",
    palavras: "ficha abas visão geral movimentações linha do tempo histórico lotação cargos",
    mostrar: (c) => c.pode("colaborador.ler"),
    conteudo: (c) => (
      <>
        <P>A ficha reúne toda a jornada do profissional. As abas que aparecem dependem do seu acesso:</P>
        <Quadro cabecalho={["Aba", "O que mostra"]} linhas={[
          ["Visão geral", <>Vínculo atual (loja, cargo, tipo, admissão, jornada, escala){c.pode("remuneracao.ler") && ", salário (oculto até clicar em Mostrar)"} e o quadro de <B>Ações</B>.</>],
          ...(c.pode("colaborador.dados_pessoais.ler") ? [["Dados pessoais", "CPF completo, nascimento, contatos, endereço e contato de emergência — exibidos sob registro na auditoria."] as ReactNode[]] : []),
          ["Movimentações", <>Histórico de lojas (lotação), cargos e situações{c.pode("remuneracao.ler") && ", e histórico salarial"}.</>],
          ["Documentos", "Documentos do colaborador que o seu perfil pode ver."],
          ["Linha do tempo", "Todos os eventos em ordem cronológica: cadastro, transferências, promoções, mudanças de situação, documentos recebidos."],
        ]} />
        <P>Na linha do tempo, o ponto <span className="font-medium text-marca">teal</span> indica evento geral e o ponto <span className="font-medium text-destaque">laranja</span> indica evento sigiloso (contratual, saúde, financeiro…). Você só vê eventos do sigilo que o seu perfil alcança.</P>
        <Dica>Nada é apagado: transferências, promoções e desligamentos ficam no histórico para sempre, com quem fez e quando.</Dica>
      </>
    ),
  },
  {
    id: "dados-pessoais", titulo: "Dados pessoais e contato de emergência", icone: Lock, grupo: "Pessoas",
    palavras: "dados pessoais cpf endereço cep telefone email nascimento contato emergência editar exibir",
    mostrar: (c) => c.pode("colaborador.dados_pessoais.ler"),
    conteudo: (c) => (
      <>
        <Passos itens={[
          <>Na ficha, abra a aba <Menu>Dados pessoais</Menu>.</>,
          <>Clique em <Menu>Exibir dados pessoais</Menu>. <B>Cada exibição fica registrada</B> na auditoria com seu nome e horário — abra só quando precisar.</>,
          ...(c.pode("colaborador.dados_pessoais.editar") ? [
            <>Para corrigir, clique em <Menu>Editar</Menu>. Ao digitar o <B>CEP</B> e sair do campo, o endereço é preenchido automaticamente; complete número e complemento.</>,
            <>Em <B>Contato de emergência</B>, clique em <Menu>Adicionar</Menu> e informe nome, parentesco e telefone.</>,
          ] : []),
        ]} />
        {!c.pode("colaborador.dados_pessoais.editar") && <Dica>O seu perfil pode consultar, mas não alterar dados pessoais.</Dica>}
      </>
    ),
  },
  {
    id: "situacao", titulo: "Mudar a situação (férias, afastamento, licença)", icone: CheckCircle2, grupo: "Pessoas",
    palavras: "situação status férias afastado licença retorno mudar admissão ativo arquivar cancelar desligamento",
    mostrar: (c) => c.pode("vinculo.status.alterar"),
    conteudo: () => (
      <>
        <Passos itens={[
          <>Na ficha, em <B>Ações</B>, clique em <Menu>Mudar situação</Menu>.</>,
          <>Escolha a nova situação — só aparecem as mudanças permitidas a partir da situação atual.</>,
          <>Informe a <B>data de efeito</B> e o <B>motivo</B> (obrigatório) e salve.</>,
        ]} />
        <T>Mudanças permitidas</T>
        <Quadro cabecalho={["De", "Para"]} linhas={[
          ["Pré-admissão", "Em admissão · Arquivado (desistência)"],
          ["Em admissão", "Ativo (início do trabalho) · Pré-admissão · Arquivado"],
          ["Ativo", "Em férias · Afastado · Em licença · Em desligamento (pelo botão próprio)"],
          ["Em férias", "Ativo (retorno)"],
          ["Afastado / Em licença", "Ativo (retorno) · Em desligamento"],
          ["Em desligamento", "Ativo (cancela o desligamento) · Desligado (só concluindo o processo)"],
          ["Desligado", "Arquivado"],
        ]} />
        <Atencao>Em afastamentos e licenças, <B>não escreva diagnóstico nem CID</B> no motivo (use, por exemplo, “Afastamento por atestado médico”). O atestado vai como documento na categoria <B>Atestados médicos</B>, que é protegida (só DP, RH e diretoria).</Atencao>
        <Dica>Desistiu de um desligamento? Use <Menu>Mudar situação</Menu> → <B>Ativo</B> e explique no motivo. O processo fica registrado como cancelado.</Dica>
      </>
    ),
  },
  {
    id: "editar-vinculo", titulo: "Editar jornada, escala e admissão prevista", icone: ClipboardList, grupo: "Pessoas",
    palavras: "editar vínculo jornada escala data admissão prevista",
    mostrar: (c) => c.pode("colaborador.editar"),
    conteudo: () => (
      <>
        <Passos itens={[
          <>Na ficha, em <B>Ações</B>, clique em <Menu>Editar dados do vínculo</Menu>.</>,
          <>Ajuste jornada semanal e escala. Enquanto o colaborador estiver em pré-admissão ou em admissão, também dá para ajustar a data de admissão prevista.</>,
        ]} />
        <Dica>Loja, cargo, salário e situação não são editados aqui: cada um tem sua ação própria, que guarda o histórico.</Dica>
      </>
    ),
  },
  {
    id: "transferir", titulo: "Transferir de loja", icone: Store, grupo: "Pessoas",
    palavras: "transferir transferência loja mudar unidade cnpj empresa lotação",
    mostrar: (c) => c.pode("colaborador.transferir"),
    conteudo: () => (
      <>
        <Passos itens={[
          <>Na ficha, em <B>Ações</B>, clique em <Menu>Transferir de loja</Menu>.</>,
          <>Escolha a loja de destino, a data e o motivo.</>,
          <>Confirme. A lotação anterior é encerrada e a nova começa na data informada.</>,
        ]} />
        <Atencao>Só aparecem lojas do <B>mesmo CNPJ</B>. Cada loja das Óticas Idealize é uma empresa diferente (Campinas, Sorocaba, Piracicaba e São Vicente têm CNPJs próprios), e mudar de empresa exige um processo próprio que ainda está sendo validado com a contabilidade. Nesses casos, fale com a diretoria.</Atencao>
        <Dica>Você precisa ter acesso às duas lojas (origem e destino). Depois da transferência, quem só tem acesso à loja de origem deixa de ver o colaborador.</Dica>
      </>
    ),
  },
  {
    id: "cargo", titulo: "Promoção e mudança de função", icone: Sparkles, grupo: "Pessoas",
    palavras: "promoção promover cargo função mudança correção",
    mostrar: (c) => c.pode("cargo.alterar"),
    conteudo: (c) => (
      <>
        <Passos itens={[
          <>Na ficha, em <B>Ações</B>, clique em <Menu>Promoção / mudança de função</Menu>.</>,
          <>Escolha o tipo: <B>Promoção</B>, <B>Mudança de função</B> ou <B>Correção de cadastro</B> (cargo lançado errado).</>,
          <>Escolha o novo cargo, a data de início e o motivo.</>,
        ]} />
        {!c.pode("config.estrutura.gerir") && <Dica>O cargo que você precisa não está na lista? Peça a quem administra a estrutura para cadastrá-lo.</Dica>}
        {c.pode("remuneracao.gerir") && <Dica>Se a promoção muda o salário, registre também a <B>Alteração salarial</B> com a mesma data.</Dica>}
      </>
    ),
  },
  {
    id: "salario", titulo: "Salário e histórico salarial", icone: Wallet, grupo: "Pessoas",
    palavras: "salário remuneração aumento reajuste alteração salarial histórico folha",
    mostrar: (c) => c.pode("remuneracao.ler") || c.pode("remuneracao.gerir"),
    conteudo: (c) => (
      <>
        <T>Consultar</T>
        <Lista itens={[
          <>Na <B>Visão geral</B> da ficha, o salário aparece como ••••••. Clique em <Menu>Mostrar</Menu> para ver o valor vigente.</>,
          <>A aba <B>Movimentações</B> traz o histórico salarial completo com datas e motivos.</>,
        ]} />
        {c.pode("remuneracao.gerir") && (
          <>
            <T>Registrar alteração</T>
            <Passos itens={[
              <>Em <B>Ações</B>, clique em <Menu>Alteração salarial</Menu>.</>,
              <>Informe o novo valor, a data de vigência e o motivo (ex.: “Reajuste convenção 2026”, “Promoção”).</>,
            ]} />
          </>
        )}
        <Atencao>Este registro é o controle interno de RH. A <B>folha oficial e o eSocial</B> continuam com o escritório de contabilidade — informe a eles toda alteração.</Atencao>
      </>
    ),
  },
  {
    id: "desligamento", titulo: "Desligamento", icone: UserMinus, grupo: "Pessoas",
    palavras: "desligamento demissão rescisão desligar justa causa acordo pedido término experiência concluir cancelar",
    mostrar: (c) => c.pode("desligamento.gerir"),
    conteudo: (c) => (
      <>
        <T>1. Iniciar</T>
        <Passos itens={[
          <>Na ficha, em <B>Ações</B>, clique em <Menu>Iniciar desligamento</Menu>.</>,
          <>Escolha a modalidade: pedido de demissão, dispensa sem justa causa, dispensa por justa causa, acordo entre as partes, término de experiência, término de prazo determinado ou outra.</>,
          <>Informe a data da comunicação e observações. A situação passa a <B>Em desligamento</B>.</>,
        ]} />
        <T>2. Providências (fora do sistema, por enquanto)</T>
        <Lista itens={[
          <>Combine com a contabilidade os cálculos e documentos rescisórios.</>,
          <>Programe o exame demissional, quando aplicável.</>,
          <>Recolha uniforme, crachá, chaves e equipamentos.</>,
          <>Envie os documentos rescisórios para a ficha (categoria <B>Desligamento</B>).</>,
        ]} />
        <T>3. Concluir</T>
        <Passos itens={[
          <>Na ficha aparece o aviso do desligamento em andamento. Clique em <Menu>Concluir desligamento</Menu>.</>,
          <>Informe a data do desligamento e confirme que as providências foram tratadas com a contabilidade.</>,
          <>A situação passa a <B>Desligado</B>: lotação e cargo são encerrados na data informada.</>,
        ]} />
        <Dica>O cadastro e todos os documentos continuam guardados — nada é apagado no desligamento.</Dica>
        {c.pode("acesso.gerir")
          ? <Atencao>Se o desligado tinha usuário no sistema, vá em <Menu>Usuários e acessos</Menu> e <B>revogue todos os perfis</B> dele no mesmo dia.</Atencao>
          : <Atencao>Se o desligado tinha usuário no sistema, avise a diretoria para revogar o acesso no mesmo dia.</Atencao>}
        <Dica>O checklist completo (documentos obrigatórios, exame, devolução de equipamentos, revogação automática de acessos) chega na próxima etapa.</Dica>
      </>
    ),
  },

  /* ---------------- Documentos ---------------- */
  {
    id: "documentos", titulo: "Consultar documentos", icone: FileText, grupo: "Documentos",
    palavras: "documentos ver visualizar baixar download sigilo status categoria vencimento filtro",
    mostrar: (c) => c.leAlgumDoc,
    conteudo: (c) => (
      <>
        <P>Os documentos ficam em armazenamento <B>privado</B>. Não existe link público: cada visualização ou download gera um link que vale <B>60 segundos</B> e fica registrado.</P>
        <Passos itens={[
          <>Abra <Menu>Documentos</Menu> no menu (todos os documentos) ou a aba <Menu>Documentos</Menu> da ficha (só daquele colaborador).</>,
          <>Filtre por loja, categoria e status.</>,
          <>Use o ícone de <B>olho</B> para visualizar numa nova aba, ou a <B>seta</B> para baixar.</>,
        ]} />
        <T>Níveis de sigilo que você pode ver</T>
        <Quadro cabecalho={["Sigilo", "Exemplos"]} linhas={c.niveisLeitura.map((n) => [<B>{SIGILO[n]}</B>, NIVEIS_DESC[n]])} />
        <T>Status do documento</T>
        <Quadro cabecalho={["Status", "Significado"]} linhas={[
          [<Selo tom="info">Recebido — conferir</Selo>, "Arquivo enviado, aguardando conferência. Ainda não vale como aprovado."],
          [<Selo tom="sucesso">Aprovado</Selo>, "Conferido e aceito."],
          [<Selo tom="perigo">Reprovado</Selo>, "Conferido e recusado — veja a observação e envie nova versão."],
          [<Selo tom="alerta">Pendente</Selo>, "Esperado, ainda sem arquivo."],
          [<Selo tom="perigo">Vencido</Selo>, "Passou da data de vencimento (a data aparece em vermelho)."],
          [<Selo>Arquivado</Selo>, "Fora de uso, mas guardado conforme a política de retenção."],
        ]} />
        <Atencao>Não baixe documentos para o computador sem necessidade. Se baixar, apague o arquivo local assim que terminar e nunca encaminhe por WhatsApp ou e-mail pessoal.</Atencao>
      </>
    ),
  },
  {
    id: "enviar", titulo: "Enviar documentos e novas versões", icone: FileText, grupo: "Documentos",
    palavras: "enviar upload anexar documento arquivo pdf foto nova versão substituir competência vencimento ia inteligência artificial leitura automática classificar",
    mostrar: (c) => c.enviaAlgumDoc,
    conteudo: (c) => (
      <>
        <Passos itens={[
          <>Clique em <Menu>Enviar documento</Menu> (na página Documentos ou na aba Documentos da ficha).</>,
          <>Arraste os arquivos para a área tracejada ou clique nela para escolher. Pode mandar <B>vários de uma vez</B> (até 30) — inclusive de colaboradores diferentes.</>,
          <>Com a <B>Leitura automática com IA</B> ligada, o sistema lê cada arquivo e preenche sozinho: <B>colaborador</B> (pelo CPF ou nome escrito no documento), <B>categoria</B>, <B>nome</B>, <B>emissão</B>, <B>competência</B> e <B>vencimento</B>.</>,
          <><B>Confira cada cartão.</B> O selo mostra a confiança da leitura: <Selo tom="sucesso">alta</Selo> <Selo tom="alerta">média</Selo> <Selo tom="perigo">baixa</Selo>. Corrija o que estiver errado — todos os campos são editáveis.</>,
          <>Cartão com aviso vermelho precisa de ajuste (ex.: colaborador não encontrado, categoria que exige competência). Quando tudo estiver certo, clique em <Menu>Enviar documentos</Menu>.</>,
        ]} />
        <Atencao>A IA <B>sugere</B>, quem envia <B>confirma</B>. Ela pode errar, principalmente em fotos ruins. E o documento enviado continua precisando de <B>conferência</B> para valer.</Atencao>
        <Dica>Na ficha de um colaborador, todos os arquivos vão para ele. Se a IA perceber que o documento é de <B>outra pessoa</B>, o cartão mostra um alerta — confira antes de enviar.</Dica>
        <Quadro cabecalho={["Regra", "Detalhe"]} linhas={[
          ["Formatos", "PDF, JPG, PNG ou WEBP. O sistema confere o conteúdo real do arquivo, não só a extensão."],
          ["Tamanho", "Até 20 MB por arquivo."],
          ["Vários de uma vez", "Até 30 arquivos; cada um vira um documento separado, com a própria categoria e colaborador."],
          ["PDF com script", "PDFs com conteúdo ativo (JavaScript, anexos embutidos) são recusados. Gere o PDF de novo ou imprima como PDF."],
          ["Competência obrigatória", "Jornada e ponto, holerites e obrigações trabalhistas."],
          ["Vencimento obrigatório", "Exames ocupacionais (ASO)."],
          ["Leitura automática", "Cada leitura fica registrada na auditoria (sem o conteúdo do documento). Se estiver indisponível, preencha manualmente."],
        ]} />
        <T>Substituir por uma nova versão</T>
        <Passos itens={[
          <>Na lista, clique no ícone de <B>setas circulares</B> do documento.</>,
          <>Escolha o arquivo novo e informe o <B>motivo</B> (ex.: “Documento ilegível”, “Versão assinada”).</>,
          <>A versão anterior fica guardada no histórico e o documento volta para <B>Recebido — conferir</B>.</>,
        ]} />
        <T>Categorias que você pode enviar</T>
        <Lista itens={c.niveisEnvio.map((n) => <><B>{SIGILO[n]}</B> — {NIVEIS_DESC[n]}</>)} />
        <Dica>Fotos de celular: enquadre só o documento, com boa luz, sem cortar bordas. Prefira PDF quando o documento tiver mais de uma página.</Dica>
      </>
    ),
  },
  {
    id: "conferir", titulo: "Conferir (aprovar ou reprovar) documentos", icone: CheckCircle2, grupo: "Documentos",
    palavras: "conferir conferência aprovar reprovar validar documento",
    mostrar: (c) => c.pode("documento.conferir"),
    conteudo: () => (
      <>
        <Passos itens={[
          <>Em <Menu>Documentos</Menu>, filtre por status <B>Recebido — conferir</B> (o Painel mostra quantos há).</>,
          <><B>Abra o arquivo</B> (ícone de olho) e confira: legível, completo, da pessoa certa, dentro da validade, assinado quando exigido.</>,
          <>Clique em <Menu>Conferir</Menu> e escolha <Menu>Aprovar</Menu> ou <Menu>Reprovar</Menu>. Para reprovar, a observação é obrigatória — explique o que precisa ser corrigido.</>,
        ]} />
        <Dica>Sua conferência fica registrada com nome e horário. Documento só é considerado válido depois de aprovado — ter sido enviado não basta.</Dica>
      </>
    ),
  },
  {
    id: "arquivar", titulo: "Arquivar documentos", icone: Archive, grupo: "Documentos",
    palavras: "arquivar arquivamento documento antigo",
    mostrar: (c) => c.pode("documento.arquivar"),
    conteudo: () => (
      <>
        <Passos itens={[
          <>Na lista de documentos, clique no ícone de <B>caixa</B> do documento.</>,
          <>Informe o motivo e confirme.</>,
        ]} />
        <P>O documento arquivado <B>não é apagado</B>: continua guardado e consultável, mas não recebe novas versões. A exclusão definitiva só acontece pela política de retenção, com autorização.</P>
      </>
    ),
  },

  /* ---------------- Equipamentos ---------------- */
  {
    id: "equipamentos", titulo: "Equipamentos sob responsabilidade", icone: Laptop, grupo: "Pessoas",
    palavras: "equipamento celular notebook chip linha tablet crachá chave máquina cartão termo responsabilidade comodato entrega devolução patrimônio imei",
    mostrar: (c) => c.pode("equipamento.ler"),
    conteudo: (c) => (
      <>
        <P>Na ficha do colaborador, a aba <Menu>Equipamentos</Menu> mostra o que está sob responsabilidade dele (celular, chip, notebook, crachá, chaves etc.), desde quando e o termo assinado.</P>
        {c.pode("equipamento.gerir") && <>
          <T>Entregar equipamentos</T>
          <Passos itens={[
            <>Abra a ficha da pessoa, aba <Menu>Equipamentos</Menu>, e clique em <Menu>Entregar equipamentos</Menu>.</>,
            <>Informe a data e cada equipamento: nome, marca/modelo e identificação (patrimônio, número de série, IMEI ou linha). Use <B>Adicionar outro equipamento</B> para entregar vários de uma vez.</>,
            <>Clique em <Menu>Imprimir termo para assinar</Menu>: o termo sai preenchido com os dados da pessoa e a lista de equipamentos.</>,
            <>Anexe o termo assinado (PDF ou foto) e clique em <Menu>Registrar entrega</Menu>. Se ainda não tiver o termo, registre assim mesmo e use <Menu>Anexar termo</Menu> depois.</>,
          ]} />
          <T>Devolução</T>
          <P>Clique em <Menu>Devolução</Menu> na linha do equipamento, informe a data e o estado (bom, danificado ou extraviado). Dano ou extravio exigem descrição.</P>
          <Dica>Lançou errado? Use o ícone de <B>cancelar</B> com o motivo. Nada é apagado: tudo fica no histórico e na linha do tempo.</Dica>
          <Atencao>No desligamento, a aba avisa se ainda há equipamentos com a pessoa. Registre a devolução antes de concluir.</Atencao>
        </>}
        <P>O termo também fica em <Menu>Documentos</Menu>, na categoria “Termos de responsabilidade de equipamentos”.</P>
      </>
    ),
  },
  /* ---------------- VT e ausências ---------------- */
  {
    id: "vale-transporte", titulo: "Vale-transporte e ausências", icone: Bus, grupo: "VT e ausências",
    palavras: "vale transporte vt passagem ônibus valor diário dias úteis falta injustificada atestado afastamento licença férias declaração horas desconto fechamento mês exportar excel",
    mostrar: (c) => c.pode("vt.ler") || c.pode("ausencia.ler"),
    conteudo: (c) => (
      <>
        <P>O VT é pago <B>antecipado</B>: o pagamento de um mês cobre os dias daquele mês e desconta as ausências do mês anterior.</P>
        <T>Como o valor é calculado</T>
        <Quadro cabecalho={["Item", "Regra"]} linhas={[
          ["Dias do mês", "Todos os dias, menos domingos, 25/12 e 01/01. Quem entra ou sai no meio do mês recebe só os dias em que estava na empresa."],
          ["Férias, afastamentos e licenças do mês", "Se já estão registrados, saem do próprio mês."],
          ["Desconto do mês anterior", "Faltas injustificadas, atestados, afastamentos, licenças e férias do mês anterior que ainda não tinham sido tirados."],
          ["Declaração de horas", "Fica registrada, mas não desconta."],
          ["Valor", "Dias a pagar × valor diário do colaborador (cadastro do VT)."],
        ]} />
        <T>Rotina do mês</T>
        <Passos itens={[
          <>Durante o mês, registre as ausências em <Menu>VT e ausências → Ausências → Registrar ausência</Menu> (falta, atestado, afastamento, licença, férias ou declaração de horas).</>,
          <>No fim do mês, abra <Menu>Cálculo do mês</Menu> e escolha o <B>mês do pagamento</B> (o próximo). Confira a prévia; quem está sem cadastro de VT aparece em destaque.</>,
          <>Clique em <Menu>Exportar (Excel)</Menu> para a planilha de pagamento e em <Menu>Fechar mês</Menu> para gravar o que foi pago.</>,
        ]} />
        <Dica>O fechamento evita descontar a mesma ausência duas vezes: férias já tiradas no pagamento de um mês não são descontadas de novo no seguinte.</Dica>
        {c.pode("vt.gerir") && <>
          <T>Cadastro do VT</T>
          <P>Em <Menu>Cadastro do VT</Menu>, informe para cada colaborador se recebe VT e o <B>valor diário</B> (ida e volta). Quem não recebe (ex.: home office) fica marcado como “Não”.</P>
        </>}
        <Atencao>Em atestados, afastamentos e licenças, <B>não escreva diagnóstico nem CID</B>. O documento vai em Documentos (categoria Atestados médicos ou Afastamentos e licenças). Ausência lançada errado é <B>cancelada com motivo</B>, não apagada.</Atencao>
        <P>O desconto de até 6% do salário não é calculado aqui: fica com a folha.</P>
      </>
    ),
  },
  /* ---------------- Uniformes ---------------- */
  {
    id: "uniformes", titulo: "Controle de uniformes", icone: Shirt, grupo: "Uniformes",
    palavras: "uniforme estoque camisa polo social camiseta tamanho entrega entregar devolução devolver pedido compra mínimo inventário contagem baixa estorno",
    mostrar: (c) => c.pode("uniforme.ler"),
    conteudo: (c) => (
      <>
        <P>O estoque de uniformes é <B>central</B> (um só para a rede). Cada peça em cada tamanho tem o seu saldo e o seu <B>estoque mínimo</B> (começa em 12). O saldo nunca é digitado: o sistema calcula a partir das entradas e saídas registradas.</P>
        <T>O que cada aba mostra</T>
        <Lista itens={[
          <><Menu>Estoque</Menu>: quanto há de cada peça, o mínimo, quanto falta e quantas estão com colaboradores.</>,
          <><Menu>Pedido de compra</Menu>: o que pedir para voltar ao mínimo (mínimo − estoque). Use <B>Copiar lista</B> para mandar ao fornecedor ou <B>Imprimir</B>.</>,
          <><Menu>Com colaboradores</Menu>: quem está com quais peças agora.</>,
          <><Menu>Movimentações</Menu>: tudo o que entrou e saiu, com data e quem registrou.</>,
        ]} />
        {c.pode("uniforme.movimentar") && <>
          <T>Entregar uniforme ao colaborador</T>
          <Passos itens={[
            <>Clique em <Menu>Entregar ao colaborador</Menu> (ou abra a ficha da pessoa, aba <Menu>Uniformes</Menu>, e clique em <Menu>Entregar</Menu>).</>,
            <>Escolha o colaborador, a peça e tamanho e a quantidade. Use <B>Adicionar outra peça</B> para entregar um kit de uma vez.</>,
            <>Confira a data e clique em <Menu>Registrar entrega</Menu>. A entrega aparece na ficha e na linha do tempo do colaborador.</>,
          ]} />
          <T>Outras movimentações</T>
          <Quadro cabecalho={["Situação", "O que usar"]} linhas={[
            ["Chegou pedido do fornecedor", <><Menu>Registrar entrada</Menu> (pode lançar várias peças juntas; anote fornecedor ou nota na observação)</>],
            ["Colaborador devolveu (ex.: desligamento, troca de tamanho)", <><Menu>Devolução</Menu>. Só aparecem as peças que ele tem em mãos; elas voltam ao estoque</>],
            ["Peça rasgada, perdida ou descartada", <>Ícone de <B>lixeira</B> na linha da peça (baixa). Motivo obrigatório</>],
            ["Contei o estoque e não bate", <>Ícone de <B>prancheta</B> (inventário). Informe quanto contou; o sistema lança só a diferença</>],
            ["Lancei errado", <>Em <Menu>Movimentações</Menu>, ícone de <B>seta circular</B> (estorno). O lançamento não é apagado: fica o original e o estorno</>],
          ]} />
          <Dica>Troca de tamanho = <B>Devolução</B> do tamanho antigo + <B>Entrega</B> do novo.</Dica>
          {!c.pode("uniforme.estoque") && <Atencao>Seu acesso permite entregar e receber uniformes dos colaboradores. Entrada de estoque, baixa, inventário e estorno ficam com o RH/DP.</Atencao>}
          <Atencao>O sistema não deixa entregar mais do que há em estoque nem registrar devolução de peças que o colaborador não tem.</Atencao>
        </>}
        {c.pode("uniforme.gerir") && <>
          <T>Cadastrar peças e ajustar o mínimo</T>
          <Lista itens={[
            <>Em <Menu>Estoque</Menu>, clique em <Menu>Nova peça / tamanho</Menu>. Cada tamanho é um item separado (ex.: POLO FEMININO P e POLO FEMININO M).</>,
            <>Para mudar o estoque mínimo, clique no <B>lápis</B> da peça. O pedido de compra se ajusta na hora.</>,
            <>Peça que não será mais usada: desmarque <B>Peça ativa</B>. Ela sai do pedido de compra, mas o histórico fica.</>,
            <>Depois de cadastrar uma peça, lance o saldo existente com <Menu>Registrar entrada</Menu>.</>,
          ]} />
        </>}
      </>
    ),
  },

  /* ---------------- Administração ---------------- */
  {
    id: "lojas", titulo: "Lojas e cargos", icone: Store, grupo: "Administração",
    palavras: "loja nova loja unidade cadastrar empresa cnpj endereço cargos ativar desativar estrutura",
    mostrar: (c) => c.pode("config.estrutura.gerir"),
    conteudo: () => (
      <>
        <T>Lojas</T>
        <Passos itens={[
          <>Abra <Menu>Lojas e estrutura</Menu> e clique em <Menu>Nova loja</Menu> (ou no lápis de uma loja para editar).</>,
          <>Escolha a <B>empresa empregadora</B> (CNPJ), o nome e um código interno (letras maiúsculas e números, sem espaço — ex.: CAMPINAS2).</>,
          <>Preencha endereço, cidade, UF, CEP e telefone.</>,
          <>Marque <B>Dados conferidos</B> só depois de checar tudo. Lojas sem essa marca aparecem como “A confirmar”.</>,
          <>Para fechar uma loja, desmarque <B>Loja ativa</B> — o histórico continua.</>,
        ]} />
        <Atencao>Loja de CNPJ novo: a empresa precisa ser cadastrada antes, pelo suporte técnico. Não reaproveite o CNPJ de outra loja.</Atencao>
        <T>Cargos</T>
        <Lista itens={[
          <>Digite o nome em <Menu>Novo cargo</Menu> e clique em <Menu>Adicionar</Menu>.</>,
          <>Clique em um cargo para <B>desativar</B> (some das opções de cadastro) ou <B>reativar</B>. Cargos não são apagados, para preservar o histórico.</>,
        ]} />
      </>
    ),
  },
  {
    id: "usuarios", titulo: "Usuários e acessos", icone: UserCog, grupo: "Administração",
    palavras: "usuário convidar convite reenviar pendente acesso perfil conceder revogar permissão loja escopo validade gerente contabilidade dp rh",
    mostrar: (c) => c.pode("acesso.gerir"),
    conteudo: () => (
      <>
        <T>Convidar alguém</T>
        <Passos itens={[
          <>Em <Menu>Usuários e acessos</Menu>, clique em <Menu>Convidar usuário</Menu>.</>,
          <>Informe nome e e-mail. A pessoa recebe o convite, cria a senha e entra <B>sem acesso nenhum</B> até você conceder um perfil.</>,
          <>O link do convite vale <B>24 horas</B>. Enquanto a pessoa não ativar a conta, aparece <B>Convite pendente</B> na linha dela: clique em <Menu>Reenviar convite</Menu> para mandar um novo e-mail (peça para olhar também o spam).</>,
        ]} />
        <T>Conceder um perfil</T>
        <Passos itens={[
          <>Na linha da pessoa, clique em <Menu>Conceder acesso</Menu>.</>,
          <>Escolha o perfil e o <B>escopo</B>: uma loja específica ou “Todas as lojas”.</>,
          <>Opcional: <B>Válido até</B> — o acesso expira sozinho (bom para contador ou advogado num caso específico).</>,
          <>Informe o motivo e confirme. Uma pessoa pode ter mais de um perfil.</>,
        ]} />
        <T>Qual perfil dar?</T>
        <Quadro cabecalho={["Perfil", "Para quem", "Pode", "Não pode"]} linhas={[
          [<B>Proprietário / Diretoria</B>, "Sócios", "Tudo", "—"],
          [<B>RH central</B>, "Responsável geral de RH com poder de diretoria", "Tudo, inclusive conceder acessos e ver auditoria", "—"],
          [<B>Departamento Pessoal</B>, "Quem cuida do dia a dia de pessoas", "Cadastros, dados pessoais, salários, situações, transferências, promoções, desligamentos, documentos (inclusive saúde e financeiros), conferência", "Dar acessos, ver auditoria, cadastrar lojas/cargos, documentos jurídicos, enviar advertências"],
          [<B>Supervisor</B>, "Supervisor (normalmente todas as lojas)", "Ver a equipe das lojas, salários (só leitura), documentos gerais, painel, entregar e receber uniformes", "CPF completo, alterar salário, saúde, cadastros e ações; entrada/baixa de estoque de uniformes"],
          [<B>Gerente de loja</B>, "Gerente (sempre com 1 loja)", "Ver a equipe da própria loja, documentos gerais (treinamentos, ponto), painel", "CPF completo, salários, saúde, cadastros e ações"],
          [<B>Contabilidade (externa)</B>, "Escritório contábil", "Dados pessoais, salários, documentos pessoais, contratuais e financeiros", "Saúde, disciplinar, cadastros e ações"],
          [<B>Jurídico</B>, "Advogado, por caso", "Leitura ampla, inclusive documentos jurídicos", "Qualquer alteração"],
          [<B>Administrador técnico</B>, "Suporte de TI", "Lojas, cargos e categorias", "Ver pessoas, documentos ou dar acessos"],
        ]} />
        <Dica>Princípio do menor acesso: dê o perfil mais restrito que resolve e limite à loja necessária. Ninguém consegue conceder acesso a si mesmo.</Dica>
        <T>Revogar</T>
        <Passos itens={[
          <>No “chip” do perfil da pessoa, clique no <B>×</B>.</>,
          <>Informe o motivo e confirme. O efeito é imediato.</>,
        ]} />
        <Atencao>Desligamento de quem tem usuário: revogue <B>todos</B> os perfis no mesmo dia. Sem perfil, a pessoa entra mas não vê nada.</Atencao>
      </>
    ),
  },
  {
    id: "auditoria", titulo: "Auditoria", icone: ScrollText, grupo: "Administração",
    palavras: "auditoria log registro quem fez histórico negado acesso lgpd",
    mostrar: (c) => c.pode("auditoria.ler"),
    conteudo: () => (
      <>
        <P>Registra automaticamente: cadastros e alterações, mudanças de salário e de situação, transferências, desligamentos, envio e conferência de documentos, concessão e revogação de acessos, leitura de dados pessoais, downloads e <B>tentativas negadas</B>.</P>
        <Passos itens={[
          <>Abra <Menu>Auditoria</Menu>. São listados os 300 registros mais recentes do filtro.</>,
          <>Filtre por <B>Área</B> (colaboradores, salários, documentos, acessos…) e por <B>Resultado</B>.</>,
          <>Clique numa linha para ver o <B>antes</B> e o <B>depois</B> da alteração.</>,
        ]} />
        <Dica>Use o filtro <B>Acesso negado</B> periodicamente: tentativas repetidas de alguém acessar o que não pode merecem conversa.</Dica>
        <P>Os registros são imutáveis — ninguém, nem a diretoria, consegue alterar ou apagar.</P>
      </>
    ),
  },

  /* ---------------- Referência ---------------- */
  {
    id: "lgpd", titulo: "Privacidade e boas práticas (LGPD)", icone: ShieldCheck, grupo: "Referência",
    palavras: "lgpd privacidade dados pessoais sigilo segurança boas práticas senha compartilhar",
    mostrar: () => true,
    conteudo: () => (
      <>
        <P>Os dados deste sistema são de pessoas reais. A lei (LGPD) exige que eles sejam usados só para a finalidade de trabalho e protegidos.</P>
        <Lista itens={[
          <><B>Login é pessoal.</B> Nunca compartilhe senha nem o app autenticador. Tudo o que é feito fica no seu nome.</>,
          <>Acesse só o que precisa para a tarefa do momento.</>,
          <>Não tire print, foto da tela nem copie dados para planilhas, WhatsApp ou e-mail pessoal.</>,
          <>Não registre informações de saúde, religião, orientação ou vida pessoal em campos de texto livre.</>,
          <>Use o sistema em computador ou celular de confiança e saia ao terminar, principalmente em máquinas compartilhadas da loja.</>,
          <>Viu algo estranho (acesso que não fez, dado errado, documento de outra pessoa)? Avise a diretoria imediatamente.</>,
        ]} />
      </>
    ),
  },
  {
    id: "duvidas", titulo: "Dúvidas frequentes", icone: HelpCircle, grupo: "Referência",
    palavras: "dúvidas faq problema erro não aparece não consigo",
    mostrar: () => true,
    conteudo: (c) => (
      <div className="flex flex-col gap-4">
        {([
          ["Um item do menu ou um botão não aparece para mim.", "Ele depende do seu perfil. O sistema só mostra o que você pode usar. Se precisar, peça o acesso a quem administra os usuários."],
          ["Aparece “Seu usuário ainda não tem acesso”.", "Você entrou, mas ainda não recebeu perfil. Avise a diretoria ou o RH."],
          ["O código do app autenticador não funciona.", "Confira o horário automático do celular e digite o código atual (ele muda a cada 30 s)."],
          c.pode("colaborador.ler") && ["Não encontro um colaborador.", "Troque a Situação para “Todos” (ele pode estar desligado) e confira se ele é de uma loja do seu acesso."],
          c.pode("colaborador.criar") && ["O cadastro diz que o CPF já existe.", "A pessoa já está no sistema (talvez desligada). Busque com Situação “Todos”. Readmissão chega na próxima etapa."],
          c.pode("colaborador.transferir") && ["A loja de destino não aparece na transferência.", "Só aparecem lojas do mesmo CNPJ e às quais você tem acesso. Entre empresas diferentes do grupo, fale com a diretoria."],
          c.enviaAlgumDoc && ["O envio do documento falhou.", "Confira formato (PDF, JPG, PNG, WEBP) e tamanho (até 20 MB). PDF recusado por conteúdo ativo: gere o PDF de novo (Imprimir → Salvar como PDF)."],
          c.leAlgumDoc && ["O link do documento não abre mais.", "Por segurança ele vale 60 segundos. Clique de novo no ícone para gerar outro."],
          ["Fui desconectado sozinho.", "A sessão termina após 20 minutos sem uso. Entre novamente."],
        ].filter(Boolean) as [string, string][]).map(([p, r]) => (
          <div key={p}>
            <p className="text-sm font-semibold">{p}</p>
            <p className="text-sm text-texto-suave">{r}</p>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "em-breve", titulo: "O que vem nas próximas etapas", icone: Sparkles, grupo: "Referência",
    palavras: "próximas etapas em breve futuro admissão férias ponto contratos tarefas",
    mostrar: () => true,
    conteudo: () => (
      <Lista itens={[
        <><B>Departamento Pessoal:</B> fluxo de admissão com checklist, contratos e prazos (experiência), férias com períodos aquisitivos, afastamentos, espelhos de ponto com fechamento mensal, desligamento com checklist completo, central de tarefas e alertas.</>,
        <><B>Conformidade:</B> obrigações trabalhistas, modelos de documentos, política de retenção, assinatura eletrônica.</>,
        <><B>Gestão de pessoas:</B> recrutamento, treinamentos, avaliações, comunicados com ciência, controle de equipamentos.</>,
        <><B>Portal do colaborador:</B> cada profissional consultando os próprios dados e documentos.</>,
      ]} />
    ),
  },
];

/* ---------------- Resumo do acesso do usuário ---------------- */
function SeuAcesso() {
  const { pode, lojasCom, temFatorMfa, permissoes } = useAuth();
  const lojas = useLojas();
  const escopo = lojasCom("colaborador.ler");
  const nomesLojas = escopo === null ? "Todas as lojas" : (lojas.data ?? []).filter((l) => escopo.includes(l.id)).map((l) => l.nome).join(", ") || "Nenhuma loja";
  const bloqueadas = permissoes.filter((p) => !p.liberada_na_sessao).length;
  const itens: [boolean, string][] = [
    [pode("colaborador.ler"), "Ver colaboradores e fichas"],
    [pode("colaborador.criar"), "Cadastrar colaboradores"],
    [pode("colaborador.dados_pessoais.ler"), "Ver dados pessoais completos (CPF, endereço)"],
    [pode("colaborador.dados_pessoais.editar"), "Editar dados pessoais"],
    [pode("vinculo.status.alterar"), "Mudar situação (férias, afastamento, licença)"],
    [pode("colaborador.transferir"), "Transferir entre lojas"],
    [pode("cargo.alterar"), "Registrar promoções e mudanças de função"],
    [pode("remuneracao.ler"), "Ver salários"],
    [pode("remuneracao.gerir"), "Registrar alterações salariais"],
    [pode("desligamento.gerir"), "Conduzir desligamentos"],
    [pode("documento.conferir"), "Conferir documentos"],
    [pode("config.estrutura.gerir"), "Cadastrar lojas e cargos"],
    [pode("acesso.gerir"), "Conceder e revogar acessos"],
    [pode("auditoria.ler"), "Consultar a auditoria"],
  ];
  const sim = itens.filter(([ok]) => ok);
  return (
    <>
      <P>Este manual foi montado para o <B>seu</B> acesso: as seções abaixo mostram só o que você pode fazer.</P>
      {pode("colaborador.ler") && <P><B>Lojas que você acessa:</B> {nomesLojas}</P>}
      {sim.length === 0 ? (
        <Atencao>Seu usuário ainda não tem perfil. Peça o acesso à diretoria ou ao RH.</Atencao>
      ) : (
        <ul className="mb-4 grid gap-2 sm:grid-cols-2">
          {sim.map(([, t]) => <li key={t} className="flex items-start gap-2 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-sucesso" aria-hidden />{t}</li>)}
        </ul>
      )}
      {bloqueadas > 0 && !temFatorMfa && (
        <Atencao>Parte das suas permissões só libera com a verificação em duas etapas ativa. Ative em <Link to="/conta" className="font-medium underline">Minha conta</Link>.</Atencao>
      )}
      <P>Precisa de algo que não está aqui? Peça a quem administra os acessos — o sistema só libera o necessário para cada função.</P>
    </>
  );
}

/* =====================================================================
   Página
   ===================================================================== */
const GRUPOS: Secao["grupo"][] = ["Começando", "Pessoas", "Documentos", "Uniformes", "VT e ausências", "Administração", "Referência"];

export function Manual() {
  const { pode, permissoes, lojasCom } = useAuth();
  const [busca, setBusca] = useState("");

  const ctx = useMemo<Ctx>(() => {
    const lib = (re: RegExp) => [...new Set(permissoes.filter((p) => p.liberada_na_sessao && re.test(p.permissao))
      .map((p) => p.permissao.split(".")[1]))];
    const ordem = Object.keys(SIGILO);
    const niveisLeitura = lib(/^documento\.[a-z]+\.ler$/).sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
    const niveisEnvio = lib(/^documento\.[a-z]+\.enviar$/).sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
    return {
      pode: (p) => pode(p),
      leDoc: (n) => niveisLeitura.includes(n),
      enviaDoc: (n) => niveisEnvio.includes(n),
      leAlgumDoc: niveisLeitura.length > 0,
      enviaAlgumDoc: niveisEnvio.length > 0,
      niveisLeitura, niveisEnvio,
      todasLojas: (p) => pode(p) && lojasCom(p) === null,
    };
  }, [pode, permissoes, lojasCom]);

  const termo = busca.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const visiveis = SECOES.filter((s) => s.mostrar(ctx)).filter((s) => !termo ||
    `${s.titulo} ${s.palavras}`.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").includes(termo));

  return (
    <>
      <div className="print:hidden">
        <CabecalhoPagina titulo="Manual do Idealize RH 360º" descricao="Montado de acordo com o seu perfil de acesso."
          acoes={<Botao variante="secundaria" icone={<Printer className="size-4" />} onClick={() => window.print()}>Imprimir / PDF</Botao>} />
      </div>
      <div className="hidden print:block">
        <img src="/logo.png" alt="Óticas Idealize" className="mb-4 w-40" />
        <h1 className="mb-1 text-2xl font-semibold">Manual do Idealize RH 360º</h1>
        <p className="mb-6 text-sm text-texto-suave">Versão personalizada para o perfil do usuário · {new Date().toLocaleDateString("pt-BR")}</p>
      </div>

      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
        {/* Índice */}
        <nav className="mb-6 print:hidden lg:sticky lg:top-8 lg:mb-0 lg:self-start" aria-label="Índice do manual">
          <div className="relative mb-4">
            <Campo rotulo="Buscar no manual" placeholder="Ex.: férias, upload, senha" value={busca} onChange={(e) => setBusca(e.target.value)} className="[&_input]:pl-9" />
            <Search className="pointer-events-none absolute bottom-3 left-3 size-4 text-texto-suave" aria-hidden />
          </div>
          <div className="hidden flex-col gap-4 lg:flex">
            {GRUPOS.map((g) => {
              const s = visiveis.filter((x) => x.grupo === g);
              if (!s.length) return null;
              return (
                <div key={g}>
                  <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-texto-suave">{g}</p>
                  <ul className="flex flex-col">
                    {s.map((x) => (
                      <li key={x.id}><a href={`#${x.id}`} className="block rounded-md px-2 py-1 text-sm text-texto-suave hover:bg-primaria-suave hover:text-primaria">{x.titulo}</a></li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </nav>

        {/* Conteúdo */}
        <div className="flex min-w-0 flex-col gap-6">
          {visiveis.length === 0 && <Aviso>Nada encontrado para “{busca}”. Tente outra palavra.</Aviso>}
          {GRUPOS.map((g) => {
            const s = visiveis.filter((x) => x.grupo === g);
            if (!s.length) return null;
            return (
              <div key={g} className="flex flex-col gap-4">
                <h2 className="font-display text-lg font-semibold text-primaria">{g}</h2>
                {s.map(({ id, titulo, icone: Icone, conteudo }) => (
                  <section key={id} id={id} className={cx("scroll-mt-20 rounded-xl border border-borda bg-superficie p-4 sm:p-6", "print:break-inside-avoid-page print:border-0 print:p-0")}>
                    <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-primaria-suave text-primaria print:hidden"><Icone className="size-4" aria-hidden /></span>
                      {titulo}
                    </h3>
                    {conteudo(ctx)}
                  </section>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
