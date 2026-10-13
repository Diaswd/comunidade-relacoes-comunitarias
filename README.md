# Comunidade · Relações Comunitárias

Plataforma responsiva para organizar o trabalho do setor de Relações Comunitárias de São Leopoldo: demandas, agenda semanal, encaminhamentos, relatórios Excel e acessos da equipe.

**Ambiente em validação.** Use dados fictícios. Não há integração oficial com sistemas da prefeitura. A adequação para uso institucional e dados pessoais precisa ser validada pela prefeitura.

## Arquitetura

- React + TypeScript + Vite: interface estática, publicável no GitHub Pages ou em outro serviço de hospedagem estática.
- Supabase Auth: contas individuais, confirmação de e-mail, senha e recuperação de acesso.
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
npm test          # PostgreSQL real em WASM: permissões, conflitos e auditoria
npm run build    # TypeScript + build estático em dist/
npm run db:check # Verificação remota somente leitura, sem autenticação
```

## Banco e primeiro acesso

Consulte [implantação e migração](docs/IMPLANTACAO.md). A migração versionada está em `supabase/migrations/`. Ela cria tabelas com prefixo `rc_` e funções internas em `rc_private`.

O primeiro administrador é cadastrado separadamente por um operador autorizado do banco. O sistema **não transforma a primeira pessoa que se cadastrar em administrador**. Somente um e-mail previamente autorizado, confirmado pelo Supabase Auth, pode vincular sua conta ao cadastro do setor.

1. Configure o envio de e-mails e os endereços de redirecionamento no Supabase.
2. Na tela **Primeiro acesso**, a pessoa informa o e-mail aprovado e cria a própria senha.
3. Confirma o e-mail no mesmo navegador e entra no sistema.
4. Em **Equipe e acessos**, a Coordenação cadastra os demais integrantes por e-mail, cargo e permissão.

Cadastrar integrantes não envia convites automaticamente. Cada integrante cria sua própria senha. Cargo é informativo; somente o perfil de permissão define o acesso.

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

No plano gratuito, GitHub Pages exige repositório público. Alterar a visibilidade exige uma decisão do proprietário; não é necessário tornar os dados do Supabase públicos para publicar a interface. Outra opção é hospedar `dist/` em um serviço que aceite o repositório privado.

## Limites atuais

- Uma equipe compartilha os registros; não é um sistema para várias organizações isoladas.
- Os registros são carregados em conjunto. Paginação e índices adicionais devem ser avaliados se o volume crescer.
- O relatório semanal mostra criação/conclusão no período e pendências atuais; não reconstrói saldos históricos.
- Histórico por consulta limitado às 250 operações mais recentes.
- Sem sincronização contínua com o protótipo anterior, notificações automáticas ou integrações de secretarias.
- O envio de e-mail depende do SMTP configurado no Supabase.

Fontes: [Supabase Auth e SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).
