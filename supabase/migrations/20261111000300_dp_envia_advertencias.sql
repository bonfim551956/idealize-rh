-- Departamento Pessoal passa a registrar advertências (antes só lia)
insert into public.perfil_permissoes (perfil_id, permissao)
select p.id, 'documento.disciplinar.enviar' from public.perfis p where p.codigo = 'departamento_pessoal'
on conflict do nothing;
