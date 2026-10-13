# Implantação e migração

## Estado em 13/10/2026

- Projeto Supabase de destino: `cubnbgggohmrwaohxibr`.
- Schema `20261013123206_community_workspace.sql` aplicado pelo SQL Editor, após testes locais.
- Cinco tabelas `rc_*` com RLS; acesso anônimo às tabelas e RPCs verificado como bloqueado.
- Importados do protótipo: 12 demandas, 3 compromissos, 3 encaminhamentos e 12 registros de histórico; mais 1 evento de auditoria da migração.
- Três cadastros de integrantes: administrador aprovado pelo proprietário e dois perfis fictícios sem login.
- O banco e a publicação anteriores foram preservados. A importação é um snapshot; edições posteriores na versão anterior não são sincronizadas.
- O cadastro autorizado da Coordenação ainda precisa ser vinculado a uma conta confirmada no Supabase Auth. Nenhuma senha foi criada pelo agente.
- Publicação externa, configuração final de e-mail e teste de entrada com o administrador ainda pendentes.

## Migrações

Para um projeto novo, revise e aplique a migração pelo Supabase CLI ou SQL Editor. Não reaplique a migração inicial em um banco já migrado.

O projeto atual recebeu a migração pelo SQL Editor. Isso **não registra automaticamente** a versão no histórico do Supabase CLI. Antes de usar `db push`, um operador autenticado deve confirmar o schema e reconciliar o histórico:

```sh
npx supabase login
npx supabase link --project-ref cubnbgggohmrwaohxibr
npx supabase migration list
# Somente após confirmar que a migração já está aplicada:
npx supabase migration repair 20261013123206 --status applied
npx supabase migration list
```

Use novas migrações para futuras alterações, sem editar uma migração já aplicada. Revise o Security Advisor após mudanças.

## Administrador inicial em outros ambientes

Execute uma única vez, substituindo os valores por dados aprovados. Não inclua e-mails reais em migrações compartilhadas.

```sql
insert into public.rc_members (name,email,"jobTitle",role)
values ('Nome da pessoa','email-aprovado@example.org','Coordenação do setor','Coordenação');
```

O usuário cria sua senha pela interface e confirma o e-mail. Não insira manualmente senhas ou identidades na tabela `auth.users` e não desative a confirmação de e-mail para contornar problemas de entrega.

## Importação do protótipo anterior

O export completo original fica apenas no armazenamento local em `exports/d1-backup.json`, fora do Git. Preserve esse arquivo e o banco de origem até a validação da migração.

```sh
node scripts/import-d1.mjs exports/d1-backup.json UUID_DO_ADMIN exports/import-d1.local.sql
```

Revise o SQL gerado e aplique em uma transação. O script converte IDs determinísticos e mantém histórico e responsáveis. Não importa credenciais. O evento de auditoria da importação é adicionado a cada execução; não execute novamente sem necessidade. Confira contagens e vínculos antes da troca definitiva.

## Configurar Auth

No Supabase, **Authentication → Emails → SMTP Settings**: configure um provedor de envio da organização. O SMTP padrão é destinado a testes, limita a entrega aos e-mails da equipe do projeto Supabase e impõe limites de envio. Não adicione usuários da aplicação como administradores do projeto apenas para contornar esse limite.

Em **Authentication → URL Configuration**:

- `Site URL`: endereço final da aplicação, com o caminho do projeto se usar Pages.
- `Redirect URLs`: exatamente o endereço final e, durante desenvolvimento, `http://127.0.0.1:5174/`.
- Não use curingas amplos em produção.

Mantenha confirmação de e-mail ativa. A aplicação solicita senha de pelo menos 12 caracteres; configure o mínimo correspondente no servidor. Senhas devem ser definidas diretamente pelas pessoas, nunca enviadas por chat ou commit.

## Critérios para a troca definitiva

1. URL final publicada e configurada em Auth.
2. Primeiro acesso com o administrador confirmado, testando salvar, atualizar, sair e entrar novamente.
3. Testar um integrante de Equipe e um de Consulta, incluindo revogação de acesso.
4. Validar exportação Excel e histórico no navegador com dados fictícios.
5. Definir backup, restauração, retenção e responsáveis operacionais antes de usar dados reais.
6. Encerrar a entrada de dados na versão anterior e comunicar qual endereço passa a ser usado.

O código inclui testes de banco para esses controles, mas eles não substituem a validação de e-mail, hospedagem e navegação no ambiente final.
