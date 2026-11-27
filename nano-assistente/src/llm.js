// Conversa livre com o Claude (opcional): responde o que os comandos fixos não cobrem
// ("qual a capital da França?", "me dá uma ideia de post"). Só liga com ANTHROPIC_API_KEY no .env.
// As ações no computador (pastas, música, agenda) continuam nos comandos fixos: o modelo só conversa.

const SYSTEM = `Você é o Nano, assistente de voz pessoal do dono da ProxysEvo, rodando no computador dele.
Responda sempre em português do Brasil, em tom próximo e simpático, como numa conversa falada.
Suas respostas são lidas em voz alta: no máximo 3 frases curtas, sem listas, sem markdown, sem emojis e sem links.
Se pedirem algo que você não consegue fazer por voz (abrir programas que não estão na lista, mexer em arquivos, comprar),
diga com naturalidade que ainda não sabe fazer isso e sugira o comando mais próximo: abrir pasta, tocar música,
anotar tarefa, marcar compromisso, ouvir as coisas do dia ou as cobranças.`;

const MAX_HISTORY = 12;

export function createLlm(config, { logger = console, clientFactory } = {}) {
  if (!config.claude.enabled) return null;
  let clientPromise = null;
  const getClient = () => {
    clientPromise ??= clientFactory
      ? Promise.resolve(clientFactory())
      : import('@anthropic-ai/sdk').then(({ default: Anthropic }) => new Anthropic()).catch(() => {
          throw new Error('pacote @anthropic-ai/sdk não instalado (rode npm install na pasta do Nano)');
        });
    return clientPromise;
  };
  const history = [];

  return {
    async ask(question, context) {
      const client = await getClient();
      // O histórico só cresce (não editamos turnos antigos); passando do limite, começa uma conversa nova.
      if (history.length >= MAX_HISTORY) history.length = 0;
      history.push({ role: 'user', content: question });
      let response;
      try {
        response = await client.beta.messages.create({
        model: config.claude.model,
        max_tokens: 2048,
        // Respostas faladas e curtas: esforço baixo deixa mais rápido.
        output_config: { effort: 'low' },
        // Se o modelo recusar por política de segurança, a API tenta de novo em outro modelo na mesma chamada.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: SYSTEM }, { type: 'text', text: context }],
        messages: history,
        });
      } catch (err) {
        history.pop();
        throw err;
      }
      if (response.stop_reason === 'refusal') {
        history.pop();
        return 'Desculpa, sobre isso eu não posso ajudar.';
      }
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
      if (!text) {
        history.pop();
        return 'Não consegui pensar numa resposta agora.';
      }
      // Devolve o conteúdo inteiro (inclusive blocos de raciocínio), sem alterar, como a API pede.
      history.push({ role: 'assistant', content: response.content });
      return text;
    },
    reset() {
      history.length = 0;
    },
  };
}
