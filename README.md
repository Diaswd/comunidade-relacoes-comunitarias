# Comunidade · Relações Comunitárias

Plataforma responsiva para organizar o trabalho do setor de Relações Comunitárias de São Leopoldo: demandas, agenda semanal, encaminhamentos, relatórios Excel e acessos da equipe.

**Site:** https://diaswd.github.io/comunidade-relacoes-comunitarias/

**Ambiente em validação.** Use dados fictícios. Não há integração oficial com sistemas da prefeitura. A adequação para uso institucional e dados pessoais precisa ser validada pela prefeitura.

## Arquitetura

- React + TypeScript + Vite: interface estática, publicável no GitHub Pages ou em outro serviço de hospedagem estática.
- Supabase Auth: contas individuais criadas pela administração, login por e-mail e senha, sem confirmação por e-mail nem cadastro público.
- Supabase Postgres: registros persistentes, permissões verificadas no servidor, controle de versões e auditoria transacional.
- GitHub: código e verificações automáticas. Senhas, backups e dados operacionais não pertencem ao repositório.

## Executar localmente

Requer Node.js 22.13 ou superior. Recomenda-se Node.js 24 LTS.

```sh
npm ci
cp .env.example .env.local
# Preencha a URL e a chave PUBLICÁVEL do projeto em .env.local.
npm run dev
```

Abra `http://127.0.0.1:5174/`. Nunca use `service_role`, `sb_secret_` ou credenciais de banco em variáveis `VITE_*`: essas variáveis ficam visíveis no navegador.

```sh
npm test          # Permissões, conflitos, auditoria e conteúdo do Excel
npm run build    # TypeScript + build estático em dist/
npm run db:check # Verificação remota somente leitura, sem autenticação
```

## Banco e primeiro acesso

Consulte [implantação e migração](docs/IMPLANTACAO.md). A migração versionada está em `supabase/migrations/`. Ela cria tabelas com prefixo `rc_` e funções internas em `rc_private`.

O primeiro administrador é cadastrado separadamente por um operador autorizado do banco. O sistema **não transforma a primeira pessoa que entrar em administrador**. Somente uma conta ativada pela administração no Supabase Auth, com e-mail previamente autorizado em `rc_members`, pode vincular-se ao cadastro do setor.

1. Mantenha **Allow new users to sign up** desativado em **Authentication → Sign In / Providers**.
2. Em **Equipe e acessos**, a Coordenação cadastra cada integrante por e-mail, cargo e permissão. O primeiro perfil é preparado no banco pelo operador autorizado.
3. Um administrador do projeto Supabase abre **Authentication → Users → Add user → Create new user**, informa o mesmo e-mail e uma senha, mantendo **Auto confirm user?** marcado.
4. A pessoa entra no site com seu e-mail e senha. O vínculo com o perfil ocorre no primeiro acesso autorizado.
5. Depois de entrar, pode usar **Alterar minha senha** no menu lateral.

Cadastrar integrantes na plataforma define permissões, mas não cria a conta no Auth nem envia convites. Cargo é informativo; somente o perfil de permissão define o acesso. O e-mail funciona como identificador de login; não há botão de login com Google.

**Senha esquecida:** a pessoa deve procurar a Coordenação. A redefinição depende de um operador autorizado do Supabase; não existe recuperação automática por e-mail nesta versão. Consulte o procedimento administrativo em [implantação](docs/IMPLANTACAO.md). Não conceda acesso ao painel do projeto aos integrantes apenas para criar contas.

| Perfil | Permissões |
| --- | --- |
| Coordenação | Editar todos os registros, exportar, gerenciar acessos e consultar auditoria geral |
| Equipe | Editar todas as demandas, agenda e encaminhamentos; registrar acompanhamentos e exportar |
| Consulta | Consultar os registros e históricos das demandas e exportar, sem alterar dados |

## Segurança implementada

- RLS habilitada em todas as tabelas públicas; nenhum dado operacional acessível anonimamente.
- Escritas somente por RPCs que validam sessão, usuário ativo, perfil, campos e versão do registro.
- O schema `rc_private` não deve ser adicionado aos schemas expostos pela API.
- Autor, horário, código e versões são controlados pelo servidor. Auditoria gravada na mesma transação da mudança.
- Dados de contato dos integrantes não são compartilhados indiscriminadamente com outros perfis.
- Edições concorrentes são recusadas quando a versão mudou. Conflitos de horário do mesmo responsável são verificados no banco.
- Não existe exclusão de registros na interface. Retenção, exclusão administrativa e backups precisam de política institucional própria. Administradores do banco continuam tendo poderes sobre a auditoria; ela não é um registro imutável certificado.

## Publicação

O workflow `Verificar` executa testes e build a cada push. O workflow `Publicar no GitHub Pages` é **manual** e só funciona depois de habilitar Pages no repositório.

Configure as variáveis de Actions `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Elas são públicas por definição, não substituem RLS. Para Pages, selecione **Settings → Pages → GitHub Actions** e execute o workflow manual. A base do projeto é definida automaticamente.

O repositório atual foi tornado público com autorização do proprietário e o site está publicado no GitHub Pages. O código público não concede acesso aos registros do Supabase.

## Limites atuais

- Uma equipe compartilha os registros; não é um sistema para várias organizações isoladas.
- Os registros são carregados em conjunto. Paginação e índices adicionais devem ser avaliados se o volume crescer.
- O relatório semanal mostra criação/conclusão no período e pendências atuais; não reconstrói saldos históricos.
- Histórico por consulta limitado às 250 operações mais recentes.
- Sem sincronização contínua com o protótipo anterior, notificações automáticas ou integrações de secretarias.
- Não há envio de e-mails ou recuperação automática de senha. O fluxo interno atual não depende de SMTP.

Fontes: [Criação administrativa de contas](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).
