// O "cérebro" do Nano: recebe o que foi dito, decide a resposta falada e a ação (abrir, tocar...).
import { extractCommand, parseIntent, normalize } from './intents.js';
import { resolveFolder, folderNames } from './system.js';
import { localYmd, localHm, addDaysYmd, falaData, falaHora, periodo, plural } from './util.js';

export const DEFAULT_SITES = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  gmail: 'https://mail.google.com',
  'e-mail': 'https://mail.google.com',
  email: 'https://mail.google.com',
  whatsapp: 'https://web.whatsapp.com',
  'whatsapp web': 'https://web.whatsapp.com',
  instagram: 'https://www.instagram.com',
  facebook: 'https://www.facebook.com',
  spotify: 'https://open.spotify.com',
  netflix: 'https://www.netflix.com',
  'chat gpt': 'https://chatgpt.com',
  claude: 'https://claude.ai',
  github: 'https://github.com',
  agenda: 'https://calendar.google.com',
  'google agenda': 'https://calendar.google.com',
  drive: 'https://drive.google.com',
  'painel': 'https://app.ativosevo.com',
  'painel da proxysevo': 'https://app.ativosevo.com',
  proxysevo: 'https://app.ativosevo.com',
};

const AJUDA =
  'Eu sei dar bom dia, falar suas coisas do dia, as cobranças, que horas são, abrir pastas como downloads e documentos, ' +
  'abrir sites como YouTube e WhatsApp, tocar música, pausar e pular, pesquisar no Google, anotar tarefas e marcar compromissos. ' +
  'É só começar com "Nano".';

export function createBrain({ config, agenda, music, system, regua, llm, logger = console }) {
  const sites = { ...DEFAULT_SITES };
  for (const [k, v] of Object.entries(config.sites || {})) sites[k.toLowerCase()] = v;
  const nome = config.nome ? `, ${config.nome}` : '';

  function resumoAgenda(ymd, quando) {
    const comp = agenda.compromissosDoDia(ymd);
    const partes = [];
    if (comp.length) {
      const itens = comp.map((c) => (c.hora ? `${c.titulo} às ${falaHora(c.hora)}` : c.titulo));
      partes.push(`${quando} você tem ${plural(comp.length, 'compromisso', 'compromissos')}: ${itens.join('; ')}.`);
    } else {
      partes.push(`${quando} você não tem compromissos marcados.`);
    }
    return partes.join(' ');
  }

  function resumoTarefas(today) {
    const pend = agenda.pendentes(today);
    if (!pend.length) return 'Nenhuma tarefa pendente.';
    const lista = pend.slice(0, 6).map((t) => t.texto).join('; ');
    return `${plural(pend.length, 'tarefa pendente', 'tarefas pendentes')}: ${lista}${pend.length > 6 ? ', e outras' : ''}.`;
  }

  async function minhasCoisas(now, { amanha = false } = {}) {
    const today = localYmd(now);
    const partes = [];
    if (amanha) {
      partes.push(resumoAgenda(addDaysYmd(today, 1), 'Amanhã'));
    } else {
      partes.push(`Hoje é ${falaData(today)}.`);
      partes.push(resumoAgenda(today, 'Hoje'));
      partes.push(resumoTarefas(today));
      if (regua.enabled) {
        try {
          partes.push(await regua.resumo(now));
        } catch (err) {
          partes.push(`Não consegui falar com a régua de cobrança: ${err.message}.`);
        }
      }
      const amanhaComp = agenda.compromissosDoDia(addDaysYmd(today, 1));
      if (amanhaComp.length) partes.push(`Amanhã tem ${plural(amanhaComp.length, 'compromisso', 'compromissos')}.`);
    }
    return partes.join(' ');
  }

  async function playMusic({ consulta, onde }) {
    if (!onde && music.count()) {
      const fila = music.pick(consulta);
      if (fila.length) {
        const fala = consulta ? `Tocando ${fila[0].title}.` : 'Bora de música!';
        return { fala, acao: { tipo: 'tocar', fila } };
      }
    }
    const destino = onde || config.musicaOnline;
    const q = consulta || 'músicas para trabalhar';
    const url =
      destino === 'spotify'
        ? `spotify:search:${encodeURIComponent(q)}`
        : `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    await system.openUrl(url);
    return { fala: `Abrindo ${consulta || 'uma seleção de músicas'} no ${destino === 'spotify' ? 'Spotify' : 'YouTube'}.`, acao: { tipo: 'aberto', url } };
  }

  /**
   * @param {string} input  texto falado/digitado
   * @param {{ requireWake?: boolean, now?: Date }} opts  requireWake: só responde se tiver "Nano" (modo escuta contínua)
   * @returns {Promise<{ ouviu: boolean, fala?: string, acao?: object, intent?: string }>}
   */
  let oferta = null; // { tipo: 'minhas_coisas', ate: timestamp } — o Nano perguntou "quer que eu fale suas coisas?"

  async function handle(input, { requireWake = false, seguimento = false, now = new Date() } = {}) {
    let command = extractCommand(input);
    if (command === null) {
      if (requireWake) return { ouviu: false };
      command = String(input || '');
    }
    const today = localYmd(now);
    const { intent, args = {} } = parseIntent(command, today, String(input || ''));
    const r = (fala, acao) => ({ ouviu: true, intent, fala, acao });

    // Resposta curta a uma pergunta do Nano ("sim", "pode falar", "não, valeu")
    const curto = normalize(command);
    const ofertaValida = oferta && oferta.ate > now.getTime();
    if (ofertaValida && /^(sim|quero|pode|claro|bora|manda|fala|pode falar|por favor|isso|uhum|aham|beleza|ok)( .*)?$/.test(curto) && intent === 'desconhecido') {
      oferta = null;
      return { ouviu: true, intent: 'minhas_coisas', fala: await minhasCoisas(now) };
    }
    if (ofertaValida && /^(nao|agora nao|depois|deixa)( .*)?$/.test(curto) && intent === 'desconhecido') {
      oferta = null;
      return { ouviu: true, intent: 'recusa', fala: 'Beleza! Qualquer coisa é só chamar.' };
    }
    // Na janela de seguimento (sem "Nano"), só vale comando reconhecido: conversa de fundo é ignorada.
    if (seguimento && intent === 'desconhecido') return { ouviu: false };
    oferta = null;

    try {
      switch (intent) {
        case 'chamado':
          return r(`Oi${nome}! Pode falar.`);
        case 'saudacao': {
          const certo = periodo(now);
          const disse = args.tipo;
          const cumprimento = ['bom dia', 'boa tarde', 'boa noite'].includes(disse) ? disse : certo;
          const capital = cumprimento.charAt(0).toUpperCase() + cumprimento.slice(1);
          const comp = agenda.compromissosDoDia(today).filter((c) => !c.hora || c.hora >= localHm(now));
          const pend = agenda.pendentes(today).length;
          let extra = '';
          if (comp.length || pend) {
            extra = ` Hoje você tem ${[comp.length && plural(comp.length, 'compromisso', 'compromissos'), pend && plural(pend, 'tarefa', 'tarefas')].filter(Boolean).join(' e ')}. Quer que eu fale suas coisas?`;
            oferta = { tipo: 'minhas_coisas', ate: now.getTime() + 60_000 };
          } else {
            extra = ' Sua agenda de hoje está livre. Em que posso ajudar?';
          }
          const correcao = disse === 'bom dia' && certo !== 'bom dia' ? ` Bom, na verdade já é ${certo}, mas valeu!` : '';
          return r(`${capital}${nome}!${correcao}${extra}`);
        }
        case 'agradecimento':
          return r('Por nada! Tô aqui.');
        case 'despedida':
          return r(`Até mais${nome}!`, { tipo: 'dormir' });
        case 'ajuda':
          return r(AJUDA);
        case 'hora':
          return r(`São ${falaHora(localHm(now))}.`);
        case 'data':
          return r(`Hoje é ${falaData(today)}.`);
        case 'minhas_coisas':
          return r(await minhasCoisas(now, args));
        case 'listar_tarefas':
          return r(resumoTarefas(today));
        case 'cobrancas':
          if (!regua.enabled) return r('A régua de cobrança ainda não está ligada ao Nano. Preencha REGUA_URL e REGUA_TOKEN no arquivo de configuração.');
          return r(await regua.resumo(now));
        case 'tocar_musica':
          return { ouviu: true, intent, ...(await playMusic(args)) };
        case 'parar_musica':
          return r('Parei.', { tipo: 'pausar' });
        case 'continuar_musica':
          return r('', { tipo: 'continuar' });
        case 'proxima_musica':
          return r('', { tipo: 'proxima' });
        case 'volume':
          return r('', { tipo: 'volume', delta: args.delta });
        case 'abrir_pasta': {
          const path = resolveFolder(args.nome, config);
          if (!path) return r(`Não achei a pasta ${args.nome}. As que eu conheço são: ${folderNames(config).join(', ')}. Dá para cadastrar outras no arquivo de configuração.`);
          await system.openFolder(path);
          return r(`Abrindo ${args.nome}.`, { tipo: 'aberto', pasta: path });
        }
        case 'abrir_site': {
          const key = args.nome.toLowerCase();
          const url = sites[key] || (/^[a-z0-9-]+\.(com|com\.br|net|org|br|io|ai)$/.test(key.replace(/\s+/g, '')) ? `https://${key.replace(/\s+/g, '')}` : null);
          if (!url) {
            const path = resolveFolder(args.nome, config);
            if (path) {
              await system.openFolder(path);
              return r(`Abrindo ${args.nome}.`, { tipo: 'aberto', pasta: path });
            }
            return r(`Não sei abrir ${args.nome} ainda. Posso pesquisar no Google, se quiser: é só dizer "Nano, pesquisa ${args.nome}".`);
          }
          await system.openUrl(url);
          return r(`Abrindo ${args.nome}.`, { tipo: 'aberto', url });
        }
        case 'pesquisar': {
          const url = `https://www.google.com/search?q=${encodeURIComponent(args.consulta)}`;
          await system.openUrl(url);
          return r(`Pesquisando ${args.consulta}.`, { tipo: 'aberto', url });
        }
        case 'nova_tarefa': {
          const t = agenda.addTarefa({ texto: args.texto });
          return r(`Anotado: ${t.texto}.`, { tipo: 'agenda' });
        }
        case 'concluir_tarefa': {
          const t = agenda.concluirTarefa({ texto: args.texto, today });
          return t ? r(`Boa! Marquei ${t.texto} como feita.`, { tipo: 'agenda' }) : r(`Não achei a tarefa ${args.texto} na sua lista.`);
        }
        case 'novo_compromisso': {
          const c = agenda.addCompromisso({ titulo: args.titulo, data: args.data || today, hora: args.hora });
          const quando = c.data === today ? 'hoje' : c.data === addDaysYmd(today, 1) ? 'amanhã' : falaData(c.data);
          return r(`Marcado: ${c.titulo}, ${quando}${c.hora ? ` às ${falaHora(c.hora)}` : ''}.${c.hora ? ' Eu te aviso meia hora antes.' : ''}`, { tipo: 'agenda' });
        }
        default: {
          if (!llm) return r('Não entendi. Diga "Nano, o que você sabe fazer" para ouvir os comandos.');
          const contexto = `Agora: ${falaData(today)}, ${localHm(now)}.${config.nome ? ` O dono se chama ${config.nome}.` : ''} ${resumoAgenda(today, 'Hoje')} ${resumoTarefas(today)}`;
          return r(await llm.ask(command, contexto));
        }
      }
    } catch (err) {
      logger.error(`[nano] erro em "${intent}": ${err.message}`);
      return r(`Ops, deu um problema: ${err.message}.`);
    }
  }

  return { handle, minhasCoisas };
}
