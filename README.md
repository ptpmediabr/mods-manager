# mods-manager

Um painel para ver, ligar, desligar, instalar e agrupar em perfis os seus mods e plugins do Claude Code, sem decorar comandos.

## Como usar

Digite `/mods` para abrir o painel **Mods**.

- **Plugins instalados**: todos os seus plugins, cada um com um botão Ligado/Desligado. Em **Detalhes** você vê a origem, a versão, o escopo e o que o plugin traz (skills, comandos, agentes, hooks, servidores MCP), e pode **Atualizar** ou **Remover** (com confirmação).
- **Filtro**: por nome, e pelos botões *Ligados* e *Desligados*.
- **Mods em desenvolvimento**: os mods que você está escrevendo na sessão atual (`~/.claude/dev-mods/<sessão>`) também aparecem, e podem ser desligados.
- **Perfis**: salve o conjunto de plugins ligados com um nome (por exemplo "Gravação" ou "Trabalho") e volte a ele com um clique.
- **Instalar novos**: busque nos marketplaces que você já adicionou e instale com um clique, no escopo `user`.

Ao ligar, desligar, instalar, atualizar ou remover, o painel recarrega os plugins (`/reload-plugins`) para a mudança valer na hora; se não conseguir, avisa para você rodar o comando. Desligar um plugin que tem servidor MCP pede um segundo clique, porque as ferramentas dele somem da sessão.

Os textos do painel estão em português.

## Instalação

Numa sessão do Claude Code **no terminal** (`claude`), digite:

```text
/plugin install mods-manager --marketplace ptpmediabr/mods-manager
```

O Claude Code pergunta se pode adicionar o marketplace (responda `y`) e depois o escopo (escolha **user** para valer em todos os projetos). Quando aparecer `Installed mods-manager. Plugin is now active.`, o mod já está rodando, sem reiniciar: use `/mods`.

O comando de instalação só funciona no terminal. Instalado no escopo *user*, o mod também carrega nas sessões do app desktop do Claude Code.

## Privacidade e o que o mod faz

- Ao abrir o painel, roda `claude plugin list` para listar o que está instalado. Ligar, desligar, instalar, atualizar e remover (`claude plugin enable`, `disable`, `install`, `update`, `uninstall`) só rodam quando você clica. **Instalar** usa o CLI do próprio Claude Code com os marketplaces que você já adicionou.
- Lê o `plugin.json` e lista as pastas de cada plugin instalado, para mostrar o que ele traz, e lê a pasta de mods em desenvolvimento da sessão.
- Para ligar ou desligar um mod em desenvolvimento, regrava o `hooks/hooks.json` dele sem mudar o conteúdo, só para forçar o recarregamento.
- Guarda no armazenamento local do Claude Code (só deste mod) os seus perfis e a lista de mods em desenvolvimento que você desligou.
- Não faz chamadas de rede por conta própria.

## Desenvolvimento

```bash
claude plugin validate .
claude plugin test .
```

Testado com o Claude Code 2.1.296.

## Licença

[MIT](LICENSE). Feito por Chiara Costa.
