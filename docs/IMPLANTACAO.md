# Implantação e migração

## Estado em 14/10/2026

- Projeto Supabase de destino: `cubnbgggohmrwaohxibr`.
- Schema `20261013123206_community_workspace.sql` aplicado pelo SQL Editor, após testes locais.
- Cinco tabelas `rc_*` com RLS; acesso anônimo às tabelas e RPCs verificado como bloqueado.
- Importados do protótipo: 12 demandas, 3 compromissos, 3 encaminhamentos e 12 registros de histórico; mais 1 evento de auditoria da migração.
- Três cadastros de integrantes: administrador aprovado pelo proprietário e dois perfis fictícios sem login.
- O banco e a publicação anteriores foram preservados. A importação é um snapshot; edições posteriores na versão anterior não são sincronizadas.
- Site publicado em https://diaswd.github.io/comunidade-relacoes-comunitarias/ e código público por autorização do proprietário.
- Conta inicial criada e ativada pelo proprietário no Supabase Auth. O vínculo com o perfil de Coordenação ocorre no primeiro login. Nenhuma senha foi criada pelo agente.
- Cadastro público e login anônimo desativados. Contas internas criadas administrativamente, sem envio de e-mail. Teste de entrada com o administrador ainda pendente.

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

No painel Supabase, abra **Authentication → Users → Add user → Create new user** e use o mesmo e-mail do perfil autorizado. Mantenha **Auto confirm user?** marcado para ativar essa conta sem enviar e-mail. A senha é definida diretamente no formulário pelo operador autorizado; nunca no chat. Não insira manualmente senhas ou identidades na tabela `auth.users`.

## Importação do protótipo anterior

O export completo original fica apenas no armazenamento local em `exports/d1-backup.json`, fora do Git. Preserve esse arquivo e o banco de origem até a validação da migração.

```sh
node scripts/import-d1.mjs exports/d1-backup.json UUID_DO_ADMIN exports/import-d1.local.sql
```

Revise o SQL gerado e aplique em uma transação. O script converte IDs determinísticos e mantém histórico e responsáveis. Não importa credenciais. O evento de auditoria da importação é adicionado a cada execução; não execute novamente sem necessidade. Confira contagens e vínculos antes da troca definitiva.

## Configurar Auth

Em **Authentication → Sign In / Providers**:

- **Allow new users to sign up:** desativado. Essa restrição também bloqueia cadastros pela API pública.
- Provedor **Email:** ativo; senha mínima de 12 caracteres.
- **Anonymous sign-ins:** desativado.
- **Confirm email:** pode permanecer ativo. A opção **Auto confirm user?** no cadastro administrativo ativa apenas a conta criada, sem envio de mensagem.

Não é necessário configurar SMTP para esse fluxo. Não use **Send invitation**, pois esse caminho depende de e-mail. Não adicione integrantes como administradores do projeto Supabase apenas para criar suas contas de aplicação.

Em **Authentication → URL Configuration**:

- `Site URL`: `https://diaswd.github.io/comunidade-relacoes-comunitarias/`.
- `Redirect URLs`: exatamente esse endereço final. Adicione endereço local somente quando necessário ao desenvolvimento.
- Não use curingas amplos em produção.

A aplicação solicita senha de pelo menos 12 caracteres. Senhas devem ser definidas diretamente no formulário, nunca enviadas por chat ou commit. Após entrar, a pessoa pode usar **Alterar minha senha**.

## Redefinição administrativa de senha

Não há recuperação automática por e-mail. Quando alguém perder o acesso, a Coordenação deve confirmar a identidade e encaminhar a um operador autorizado do Supabase. O Auth oferece `auth.admin.updateUserById(id, { password })` para redefinição em um ambiente seguro no servidor. Use uma credencial administrativa somente nesse ambiente; nunca na aplicação, nas variáveis `VITE_*`, no GitHub ou no console do navegador. A interface atual não implementa esse procedimento administrativo. Não apague e recrie contas para trocar senhas, pois isso altera sua identidade e seus vínculos.

Documentação: [atualização administrativa de usuários](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).

## Critérios para a troca definitiva

1. URL final publicada e configurada em Auth.
2. Primeiro acesso com o administrador confirmado, testando salvar, atualizar, sair e entrar novamente.
3. Testar um integrante de Equipe e um de Consulta, incluindo revogação de acesso.
4. Validar exportação Excel e histórico no navegador com dados fictícios.
5. Definir backup, restauração, retenção e responsáveis operacionais antes de usar dados reais.
6. Encerrar a entrada de dados na versão anterior e comunicar qual endereço passa a ser usado.

O código inclui testes de banco e Excel para esses controles, mas eles não substituem a validação de login, hospedagem e navegação no ambiente final.
