-- CENTRAL IDEALIZE: sistemas "livres" (abrem sem o login do Central: são públicos ou têm login próprio)
-- e cadastro de sistemas novos pela tela de Gestão de acessos.

alter table central.sistemas drop constraint sistemas_tipo_acesso_check;
alter table central.sistemas add constraint sistemas_tipo_acesso_check check (tipo_acesso in ('login','rh','livre'));

create or replace function public.central_novo_sistema(p_chave text, p_nome text, p_descricao text, p_url text,
                                                       p_cor text, p_icone text, p_tipo text, p_ordem integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not privado.central_gestor() then
    raise exception 'Sem permissão para gerir acessos' using errcode = '42501';
  end if;
  if p_tipo not in ('login','livre') then raise exception 'Tipo de acesso inválido'; end if;
  insert into central.sistemas (chave, nome, descricao, url, cor, icone, ordem, situacao, tipo_acesso, atualizado_por)
  values (lower(trim(p_chave)), trim(p_nome), nullif(trim(coalesce(p_descricao, '')), ''), nullif(trim(coalesce(p_url, '')), ''),
          coalesce(nullif(p_cor, ''), '#0B6E71'), coalesce(nullif(p_icone, ''), 'app'), coalesce(p_ordem, 99),
          case when nullif(trim(coalesce(p_url, '')), '') is null then 'em_breve' else 'ativo' end, p_tipo, auth.uid());
exception when unique_violation then
  raise exception 'Já existe um sistema com este código';
end $$;

-- liberar: nos sistemas "livres" o login é opcional (a pessoa usa o login próprio do sistema, se houver)
create or replace function public.central_conceder(p_usuario uuid, p_sistema text, p_conta text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tipo text; v_conta text := nullif(trim(coalesce(p_conta, '')), '');
begin
  if not privado.central_gestor() then
    raise exception 'Sem permissão para gerir acessos' using errcode = '42501';
  end if;
  select s.tipo_acesso into v_tipo from central.sistemas s where s.chave = p_sistema;
  if v_tipo is null then raise exception 'Sistema inexistente'; end if;
  if v_tipo = 'rh' then raise exception 'O acesso ao RH é dado pelos perfis do próprio RH'; end if;
  if v_tipo = 'login' and v_conta is null then raise exception 'Informe o login da pessoa neste sistema'; end if;
  if not exists (select 1 from public.usuarios u where u.id = p_usuario and u.ativo) then
    raise exception 'Usuário inexistente ou inativo';
  end if;
  if v_conta is not null and exists (select 1 from central.acessos a where a.sistema = p_sistema and a.ativo
               and upper(a.conta) = upper(v_conta) and a.usuario_id <> p_usuario) then
    raise exception 'Este login já está ligado a outra pessoa';
  end if;
  update central.acessos set ativo = false, revogado_por = auth.uid(), revogado_em = now(), motivo = 'SUBSTITUÍDO'
   where usuario_id = p_usuario and sistema = p_sistema and ativo;
  insert into central.acessos (usuario_id, sistema, conta, concedido_por)
  values (p_usuario, p_sistema, v_conta, auth.uid());
end $$;

revoke all on function public.central_novo_sistema(text, text, text, text, text, text, text, integer) from public, anon;
grant execute on function public.central_novo_sistema(text, text, text, text, text, text, text, integer) to authenticated;

insert into central.sistemas (chave, nome, descricao, url, cor, icone, ordem, situacao, tipo_acesso) values
  ('ranking',    'Ranking',    'Ranking de vendas das lojas e consultores', null, '#C2410C', 'trofeu',  6, 'em_breve', 'livre'),
  ('avaliacoes', 'Avaliações', 'Avaliações do Google e ranking de menções',  null, '#B45309', 'estrela', 7, 'em_breve', 'livre');

-- como o sistema abre: dentro do Central (moldura) ou em nova aba (sites que não aceitam moldura, ex.: login do Google)
alter table central.sistemas add column abrir_em text not null default 'central' check (abrir_em in ('central','nova_aba'));
update central.sistemas set abrir_em = 'nova_aba' where chave = 'avaliacoes';
-- (funções central_menu e central_editar_sistema: ver o projeto; versões com abrir_em)
