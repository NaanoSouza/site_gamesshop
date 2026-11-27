# Templates para aprovar na Meta (WhatsApp Cloud API)

Crie no **WhatsApp Manager → Modelos de mensagem**, um por etapa:
- **Categoria:** Utilidade (Utility).
- **Idioma:** Português (BR), código `pt_BR`.
- **Sem botão e sem mídia.**

O nome precisa ser exatamente o da tabela, porque é ele que a régua chama (prefixo configurável em `WHATSAPP_TEMPLATE_PREFIX`).

As variáveis são sempre estas 7, **nesta ordem**:

| Variável | Conteúdo | Exemplo para a Meta |
|---|---|---|
| `{{1}}` | primeiro nome | Ana |
| `{{2}}` | quantidade de proxies | 3 |
| `{{3}}` | portas | 10001, 10002, 10003 |
| `{{4}}` | data de vencimento | 30/11/2026 |
| `{{5}}` | valor necessário | R$ 53,70 |
| `{{6}}` | saldo atual | R$ 10,00 |
| `{{7}}` | link de recarga | https://app.ativosevo.com/recarga |

> A Meta exige que todas as variáveis apareçam no texto e que o texto não comece nem termine com variável.
> Por isso cada template termina com uma frase fixa.

## cobranca_d7
```
Olá, {{1}}! Seus {{2}} proxy(s) da ProxysEvo (portas {{3}}) vencem em {{4}}. Para a renovação automática acontecer, o saldo precisa ser de {{5}}; seu saldo atual é {{6}}. Para recarregar: {{7}} . Se já recarregou, desconsidere esta mensagem.
```

## cobranca_d3
```
Olá, {{1}}. Lembrete: seus {{2}} proxy(s) da ProxysEvo (portas {{3}}) vencem em {{4}}. Valor para renovar: {{5}}. Saldo atual: {{6}}. Para recarregar: {{7}} . Se já recarregou, desconsidere esta mensagem.
```

## cobranca_d1
```
Olá, {{1}}. Seus {{2}} proxy(s) da ProxysEvo (portas {{3}}) vencem amanhã, {{4}}. Valor para renovar: {{5}}. Saldo atual: {{6}}. Para recarregar: {{7}} . Se já recarregou, desconsidere esta mensagem.
```

## cobranca_d0
```
Olá, {{1}}. Seus {{2}} proxy(s) da ProxysEvo (portas {{3}}) vencem hoje, {{4}}. Valor para renovar: {{5}}. Saldo atual: {{6}}. Para recarregar: {{7}} . Se já recarregou, desconsidere esta mensagem.
```

## cobranca_recuperacao
```
Olá, {{1}}. Seus {{2}} proxy(s) da ProxysEvo (portas {{3}}) venceram em {{4}} e estão suspensos. Recarregue {{5}} para reativar o mesmo IP (saldo atual: {{6}}). Para recarregar: {{7}} . Depois de 2 dias suspenso, o IP é liberado.
```

## Rodapé de opt-out (LGPD)

Em cada template, ative o rodapé **"Para não receber mais, responda PARAR"**: no campo Rodapé, escreva esse texto.
A régua já entende "PARAR", "SAIR", "STOP" e "CANCELAR" pelo webhook e tira o cliente dos lembretes.

## Depois de aprovados

1. Preencha no `.env`: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` (token permanente de usuário do sistema), `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN`.
2. Configure o webhook do app em `https://SEU-DOMINIO/webhooks/whatsapp`, assinando os campos **messages**.
3. Troque para `WHATSAPP_MODE=real`, reinicie e rode **"Ver prévia"** no painel antes de ligar a régua.
