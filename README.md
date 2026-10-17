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
3. A Coordenação usa **Criar acessos da equipe**, confere os integrantes pendentes e informa uma senha inicial para as contas novas. As contas são ativadas sem envio de e-mail. O administrador inicial ainda deve ser criado pelo painel Supabase, conforme a documentação de implantação.
4. A pessoa entra no site com seu e-mail e a senha inicial. Contas que já existem mantêm sua senha, inclusive a conta de quem realiza a operação.
5. Depois de entrar, pode usar **Alterar minha senha** no menu lateral.

Cadastrar integrantes define permissões; a ação **Criar acessos da equipe** cria os logins pendentes no Auth. A senha inicial vale para o lote confirmado e não fica armazenada como padrão para cadastros futuros. Cargo é informativo; somente o perfil de permissão define o acesso. O e-mail funciona como identificador de login; não há botão de login com Google.

**Senha esquecida:** a pessoa deve procurar a Coordenação. A redefinição depende de um operador autorizado do Supabase; não existe recuperação automática por e-mail nesta versão. Consulte o procedimento administrativo em [implantação](docs/IMPLANTACAO.md). Não conceda acesso ao painel do projeto aos integrantes apenas para criar contas.

| Perfil | Permissões |
| --- | --- |
| Coordenação | Editar, anexar e excluir registros; recuperar pela lixeira; exportar; gerenciar acessos e auditoria geral |
| Equipe | Editar, anexar e excluir demandas, agenda e encaminhamentos; registrar acompanhamentos e exportar |
| Consulta | Consultar os registros e históricos das demandas e exportar, sem alterar dados |

## Endereços, anexos e exclusão

Em **Cadastrar demanda**, digite uma rua ou local e selecione uma das sugestões. A busca usa Photon/OpenStreetMap na região de São Leopoldo; o botão **Maps** abre a localização no Google Maps. Também é possível preencher manualmente ou colar um link do Maps. Endereço e link aparecem nos detalhes e no Excel.

Em novas demandas e compromissos, use **Salvar e adicionar arquivos**. Depois, **Adicionar arquivos → Enviar arquivos**. Registros existentes oferecem os anexos ao abrir seus detalhes. Coordenação e Equipe podem enviar qualquer formato, até **50 MB por arquivo e 50 anexos por registro**, incluindo os que estão na lixeira. Consulta pode visualizar e baixar. Os arquivos originais são preservados, inclusive metadados; formatos executáveis, HTML e SVG são disponibilizados somente para download, nunca incorporados à página.

**Excluir** pede confirmação e retira demandas, compromissos, encaminhamentos ou anexos das listas. A Coordenação pode recuperá-los em **Privacidade e auditoria → Lixeira**. Ao excluir a demanda, seus encaminhamentos e anexos ficam ocultos até a recuperação. A recuperação de agenda verifica conflitos de horário. A exclusão não apaga definitivamente os arquivos do armazenamento.

As abas **Equipe e acessos** e **Privacidade e auditoria** ficam disponíveis somente à Coordenação, inclusive ao tentar abrir o endereço direto. Os dados necessários para atribuir responsáveis continuam disponíveis nos formulários da equipe.

A busca de endereço envia somente o texto digitado ao serviço Photon, com espera de 700 ms, cancelamento e cache temporário. O serviço público não oferece garantia de disponibilidade; o preenchimento manual continua funcionando. [Serviço e condições de uso](https://github.com/komoot/photon), [API](https://github.com/komoot/photon/blob/master/docs/api-v1.md), [limites de arquivos do Supabase](https://supabase.com/docs/guides/storage/uploads/file-limits).

## Segurança implementada

- RLS habilitada em todas as tabelas públicas; nenhum dado operacional acessível anonimamente.
- Escritas somente por RPCs que validam sessão, usuário ativo, perfil, campos e versão do registro.
- O schema `rc_private` não deve ser adicionado aos schemas expostos pela API.
- Autor, horário, código e versões são controlados pelo servidor. Auditoria gravada na mesma transação da mudança.
- Dados de contato dos integrantes não são compartilhados indiscriminadamente com outros perfis.
- Edições concorrentes são recusadas quando a versão mudou. Conflitos de horário do mesmo responsável são verificados no banco.
- A Coordenação pode excluir somente exemplos importados e identificados, em **Privacidade e auditoria → Excluir demonstrações**. A tela confere as quantidades e exige digitar `EXCLUIR`. Novos registros, contas reais, exemplos alterados e auditoria são preservados. Essa limpeza antiga de exemplos é definitiva e separada da lixeira dos registros operacionais.
- Retenção, exclusão administrativa e backups precisam de política institucional própria. Administradores do banco continuam tendo poderes sobre a auditoria; ela não é um registro imutável certificado.

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
