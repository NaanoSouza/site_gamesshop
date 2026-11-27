# Nano — seu assistente de voz

Fale **"Bom dia, Nano"** e ele responde. Peça suas coisas do dia, abra pastas, coloque música, anote tarefas.
Roda **no seu computador**: não precisa de servidor, domínio nem Supabase.

## Instalar (Windows) — uma vez só

1. Instale o **Node.js** (versão 22 ou mais nova): https://nodejs.org/pt → botão verde → Avançar até o fim.
2. Baixe a pasta `nano-assistente` (branch `feature/regua-cobranca` no GitHub: botão verde **Code → Download ZIP**) e descompacte num lugar fixo, por exemplo `C:\Nano`.
3. Clique duas vezes em **`Iniciar Nano.bat`**.
   - Na primeira vez ele prepara tudo sozinho (leva um minutinho).
   - Abre uma janela do Nano e uma janela preta minimizada (é o "motor" do Nano; deixe aberta).
4. Na janela do Nano, marque **"Escuta contínua"** e **permita o microfone** quando o navegador perguntar.
5. (Opcional) Clique duas vezes em **`Abrir Nano ao ligar o PC.bat`**: cria o atalho "Nano" na área de trabalho e faz ele abrir sozinho quando o computador ligar.

No Mac: clique duas vezes em `Iniciar Nano.command`. Se o Mac bloquear, clique com o botão direito → Abrir.

## O que falar

Comece sempre com **"Nano"** (no começo ou no fim da frase). Logo depois de ele responder, dá para responder sem repetir "Nano" (ex.: "sim").

| Você diz | O Nano faz |
|---|---|
| "Bom dia, Nano" / "Boa noite, Nano" | Responde e conta quantos compromissos e tarefas você tem. Se você disser "sim", ele fala tudo |
| "Nano, fala minhas coisas" / "o que eu tenho hoje?" | Data, compromissos, tarefas pendentes e cobranças |
| "Nano, o que eu tenho amanhã?" | Compromissos de amanhã |
| "Nano, como estão as cobranças?" | Resumo da régua de cobrança (precisa configurar, ver abaixo) |
| "Nano, abre a pasta Downloads" / "abre os documentos" | Abre a pasta no Explorador |
| "Nano, abre a pasta trabalho" | Abre uma pasta sua (cadastre em `PASTAS`) |
| "Nano, coloca uma música" / "toca Legião Urbana" | Toca da sua pasta de músicas ou abre no YouTube/Spotify |
| "Nano, pausa" / "continua" / "próxima" / "aumenta o volume" | Controla a música da pasta |
| "Nano, toca samba no Spotify" | Abre a busca no Spotify |
| "Nano, abre o YouTube" / "o WhatsApp" / "o Gmail" / "o painel" | Abre o site |
| "Nano, pesquisa preço do dólar" | Pesquisa no Google |
| "Nano, anota comprar café" | Cria uma tarefa |
| "Nano, terminei comprar café" | Marca a tarefa como feita |
| "Nano, marca reunião com o João amanhã às 10" | Cria compromisso e avisa 30 minutos antes |
| "Nano, me lembra de tomar remédio às 8 e meia da noite" | Cria lembrete com hora |
| "Nano, que horas são?" / "que dia é hoje?" | Responde |
| "Nano, o que você sabe fazer?" | Lista os comandos |
| Qualquer outra pergunta | Responde com o Claude, se você colocar a chave (ver abaixo) |

Na tela também dá para **digitar**, marcar tarefas, criar tarefas "todo dia" (voltam desmarcadas a cada manhã)
e compromissos que se repetem (todo dia, dias úteis, semanal, mensal).

## Configurar (arquivo `.env`, abre no Bloco de Notas)

| Linha | Para quê |
|---|---|
| `SEU_NOME=Nano` | Como ele te chama |
| `PASTAS=trabalho=C:\Trabalho;proxys=D:\ProxysEvo` | Pastas extras por voz |
| `MUSICA_DIR=C:\Users\Voce\Music` | Pasta de músicas (tocar, pausar e pular por voz) |
| `MUSICA_ONLINE=spotify` | O que não estiver na pasta abre no Spotify em vez do YouTube |
| `REGUA_URL=` e `REGUA_TOKEN=` | Liga as cobranças da régua (endereço do painel e o ADMIN_TOKEN dela) |
| `ANTHROPIC_API_KEY=` | Liga a conversa livre com o Claude (chave em https://platform.claude.com) |

Depois de mudar o `.env`, feche a janela preta do Nano e clique de novo em `Iniciar Nano.bat`.

## Bom saber

- **Navegador:** use o Edge (já vem no Windows) ou o Chrome. O Firefox não tem reconhecimento de voz.
- **Internet:** o reconhecimento de voz do navegador usa a internet (serviço da Microsoft no Edge, do Google no Chrome).
  Com a escuta contínua ligada, o navegador manda o áudio para esse serviço enquanto a janela do Nano está aberta. Para não ouvir, desmarque "Escuta contínua" e use o clique na bolinha.
- **Suas coisas ficam no seu computador:** agenda e tarefas ficam em `nano-assistente\data\agenda.json`. Só a pergunta livre vai para o Claude (se você ligar).
- **Segurança:** o Nano só aceita conexões do próprio computador e não executa comandos livres: só abre pastas que existem, sites http/https e Spotify.
- A janela do Nano precisa estar aberta (pode ficar minimizada) para ele ouvir e avisar dos compromissos.

## Problemas comuns

| Problema | Solução |
|---|---|
| "O navegador bloqueou o microfone" | Clique no cadeado ao lado do endereço → Microfone → Permitir |
| Ele não ouve o "Nano" | Fale "Nano" com clareza no começo da frase; confira o microfone padrão do Windows |
| Música não toca | Clique uma vez na tela do Nano (o navegador exige um clique antes de tocar som) |
| A janela não abre | Abra http://127.0.0.1:3790 no navegador |
| "já tem um Nano rodando" | Está tudo certo: ele já estava aberto |
