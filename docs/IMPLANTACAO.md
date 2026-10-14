# Implantação e migração

## Estado em 14/10/2026

- Projeto Supabase de destino: `cubnbgggohmrwaohxibr`.
- Schema `20261013123206_community_workspace.sql` aplicado pelo SQL Editor, após testes locais.
- Cinco tabelas `rc_*` com RLS; acesso anônimo às tabelas e RPCs verificado como bloqueado.
- Importados do protótipo: 12 demandas, 3 compromissos, 3 encaminhamentos e 12 registros de histórico; mais 1 evento de auditoria da migração.
- Três cadastros de integrantes: administrador aprovado pelo proprietário e dois perfis fictícios sem login.
- O banco e a publicação anteriores foram preservados. A importação é um snapshot; edições posteriores na versão anterior não são sincronizadas.
- Site publicado em https://diaswd.github.io/comunidade-relacoes-comunitarias/ e código público por autorização do proprietário.
- Conta inicial criada e ativada pelo proprietário no Supabase Auth; primeiro login realizado e perfil de Coordenação carregado no site publicado. Nenhuma senha foi criada pelo agente.
- Cadastro público e login anônimo desativados. Contas internas criadas administrativamente, sem envio de e-mail.

## Verificação da versão de acesso interno

- Código funcional publicado: commit `57b2ba5`. Verificação automática e publicação no GitHub Actions concluídas com sucesso.
- 22 testes passaram: permissões e auditoria no PostgreSQL, conflitos de edição, validação de campos e conteúdo/estrutura do Excel.
- Verificação remota somente leitura confirmou cadastro público e login anônimo desativados, cinco tabelas protegidas e RPC de carregamento inacessível a visitantes.
- Security Advisor do Supabase sem alertas na verificação de 14/10/2026.
- Login da Coordenação e manutenção da sessão após recarregar a página verificados no site publicado. Carregadas 12 demandas, 3 compromissos e 3 encaminhamentos.
- Filtro de Feitoria retornou 2 demandas. A exportação foi registrada no Supabase e o download do Excel foi confirmado pelo proprietário.
- Formulário de alteração de senha conferido sem enviar alterações de credenciais.
- A simulação de viewport móvel não foi aplicada pelo Chrome controlado nesta sessão. A conferência visual desta atualização em celular continua pendente. Também continuam pendentes os testes manuais com contas de Equipe/Consulta e o fluxo completo de edição no ambiente final; os controles correspondentes passaram nos testes de banco.

## Migrações

A opção **Excluir demonstrações** usa a migração `20261014162619_demo_cleanup.sql`, aplicada pelo SQL Editor após falha de estado de requisição do conector de migrações. Ela cria o manifesto privado e a RPC de conferência/exclusão. Assim como a migração inicial, sua versão precisa ser reconciliada no histórico do CLI antes de um futuro `db push`.

O manifesto foi preparado a partir do arquivo original revisado de importação, com `node scripts/register-demo.mjs exports/import-d1.local.sql exports/demo-manifest.local.sql`. Foram identificadas 12 demandas, 3 compromissos, 3 encaminhamentos e 2 perfis fictícios. Essa preparação não exclui dados. Nunca registre automaticamente todas as linhas atuais como demonstrações.

Somente a Coordenação pode conferir ou executar a exclusão. O banco compara cada exemplo com sua versão original, preserva alterações, novos acompanhamentos e vínculos com trabalho mantido. A conferência devolve um identificador da seleção; se ela mudar antes da confirmação, a exclusão é recusada. Todas as remoções e seus conteúdos anteriores ficam registrados na auditoria, sem excluir contas do Auth. Não há botão de desfazer.

Os 27 testes locais passaram, incluindo acesso negado para Equipe/Consulta/visitantes, ausência de efeitos na conferência, confirmação desatualizada, preservação de trabalho novo/alterado, auditoria e repetição sem efeitos. O build passou.

O Security Advisor após essa migração apontou dois avisos: [RLS sem política](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) no manifesto privado (intencional: acesso direto negado a todos os clientes, somente a função validada o utiliza) e [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) no Auth. A opção de limpeza não altera as configurações de senha.

Para um projeto novo, revise e aplique a migração pelo Supabase CLI ou SQL Editor. Não reaplique a migração inicial em um banco já migrado.

O projeto atual recebeu a migração pelo SQL Editor. Isso **não registra automaticamente** a versão no histórico do Supabase CLI. Antes de usar `db push`, um operador autenticado deve confirmar o schema e reconciliar o histórico:

```sh
npx supabase login
npx supabase link --project-ref cubnbgggohmrwaohxibr
npx supabase migration list
# Somente após confirmar que a migração já está aplicada:
npx supabase migration repair 20261013123206 --status applied
npx supabase migration repair 20261014162619 --status applied
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

## Criar os acessos da equipe pelo sistema

A migração `20261014172347_internal_accounts.sql` foi aplicada pelo conector Supabase em 14/10/2026 e consta no histórico remoto. O arquivo local, inicialmente gerado pelo CLI, foi renomeado para a versão atribuída pelo conector. As duas migrações anteriores continuam exigindo a reconciliação descrita acima.

A Edge Function `provision-team` foi publicada com verificação de JWT habilitada. Ela usa as variáveis administrativas fornecidas pelo ambiente de execução do Supabase, sem credencial administrativa no cliente. Em outro ambiente, aplique a migração e publique a função antes da interface; ajuste a origem permitida em `handler.ts` se a hospedagem mudar. Para publicar pelo CLI, consulte `supabase functions deploy --help` e use `supabase functions deploy provision-team --project-ref ID_DO_PROJETO` com um operador autenticado.

Em **Equipe e acessos → Criar acessos da equipe**, a Coordenação confere os integrantes ativos, reais e ainda sem vínculo e digita uma senha inicial de 12 a 128 caracteres. Até 50 acessos podem ser criados por lote. Não há envio de e-mail. A troca posterior em **Alterar minha senha** é opcional.

A função valida a sessão e a permissão de Coordenação antes de cada criação. Contas existentes são somente vinculadas, com a senha preservada; não existe redefinição de senha nesse fluxo. Os vínculos usam a versão revisada do cadastro e geram auditoria sem credenciais. Se parte do lote falhar, confira a lista novamente: contas já criadas podem ser vinculadas na tentativa seguinte, sem recriação ou troca de senha. A senha informada é transitória e não é persistida como configuração padrão do sistema.

Foram aprovados 34 testes locais e o build: criação e vínculo de contas, bloqueio de visitantes/Equipe/Consulta, revogação durante o lote, conflito de versões, proteção das contas existentes e ausência de senhas na auditoria e nas respostas. A verificação remota confirmou as duas RPCs instaladas e inacessíveis ao papel anônimo. O Security Advisor manteve apenas os dois avisos já documentados na seção de migrações, sem novos apontamentos.

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
