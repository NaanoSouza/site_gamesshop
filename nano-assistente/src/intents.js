// Entende o que foi dito (em português) e devolve uma intenção + argumentos. Funções puras, testáveis.

/** minúsculas, sem acento, sem pontuação, espaços normalizados */
export function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}:\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// O reconhecimento de voz às vezes escreve "nano" como "nanu", "nanô" (sem acento vira nano), "na no".
export const WAKE_WORDS = ['nano', 'nanu', 'na no', 'nana'];

/**
 * Procura a palavra de ativação. Devolve o comando sem ela, ou null se não foi chamado.
 * "bom dia nano" → "bom dia"; "nano abre a pasta downloads" → "abre a pasta downloads"
 */
export function extractCommand(transcript) {
  const t = normalize(transcript);
  for (const w of WAKE_WORDS) {
    const re = new RegExp(`(^|\\s)(ei |oi |ok |e ai )?${w}(\\s|$)`);
    const m = t.match(re);
    if (m) {
      const cmd = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
      return cmd;
    }
  }
  return null;
}

const STRIP_ARTICLES = /^(a|o|as|os|uma|um|minha|meu|minhas|meus|da|do|de|na|no)\s+/;
const stripArticles = (s) => {
  let out = s.trim();
  for (let i = 0; i < 3; i++) out = out.replace(STRIP_ARTICLES, '');
  return out.trim();
};

const DIAS_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const NUMEROS = { uma: 1, um: 1, duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, meio: 12 };

/** "amanha as 10", "dia 5 as 14:30", "segunda as 9h", "hoje as 3 da tarde" → { data, hora, resto } */
export function parseWhen(text, today) {
  let t = ` ${text} `;
  let data = null;
  let hora = null;
  const base = new Date(`${today}T12:00:00Z`);
  const add = (n) => new Date(base.getTime() + n * 86_400_000).toISOString().slice(0, 10);

  if (/\sdepois de amanha\s/.test(t)) { data = add(2); t = t.replace(/\sdepois de amanha\s/, ' '); }
  else if (/\samanha\s/.test(t)) { data = add(1); t = t.replace(/\samanha\s/, ' '); }
  else if (/\shoje\s/.test(t)) { data = today; t = t.replace(/\shoje\s/, ' '); }
  const dia = t.match(/\s(?:no )?dia (\d{1,2})(?:\/(\d{1,2}))?\s/);
  if (!data && dia) {
    const d = Number(dia[1]);
    let month = dia[2] ? Number(dia[2]) : base.getUTCMonth() + 1;
    let year = base.getUTCFullYear();
    if (!dia[2] && d < base.getUTCDate()) month += 1;
    if (month > 12) { month = 1; year += 1; }
    if (d >= 1 && d <= 31) data = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    t = t.replace(dia[0], ' ');
  }
  if (!data) {
    for (let i = 0; i < 7; i++) {
      const re = new RegExp(`\\s(?:na |no |nesta |neste |proxima |proximo )?${DIAS_SEMANA[i]}(?: feira| -feira)?\\s`);
      if (re.test(t)) {
        const diff = (i - base.getUTCDay() + 7) % 7 || 7;
        data = add(diff);
        t = t.replace(re, ' ');
        break;
      }
    }
  }
  const h = t.match(/\s(?:as|a|ao|para as|pras|pra|de)?\s?(\d{1,2}|uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|meio dia)(?:\s?(?:h|horas?|:)\s?(\d{2})?)?(?:\s?e (meia|\d{1,2}))?(?: da (manha|tarde|noite))?\s/);
  // grupos: 1 = hora, 2 = minutos ("14:30"/"14h30"), 3 = "e meia"/"e 15", 4 = período do dia
  if (h && (/\s(as|a|ao|pras|pra)\s/.test(h[0]) || /h|hora|:/.test(h[0]) || h[4] || h[1] === 'meio dia')) {
    let hh = /^\d+$/.test(h[1]) ? Number(h[1]) : h[1] === 'meio dia' ? 12 : NUMEROS[h[1]];
    const mm = h[2] ? Number(h[2]) : h[3] === 'meia' ? 30 : h[3] ? Number(h[3]) : 0;
    if ((h[4] === 'tarde' || h[4] === 'noite') && hh < 12) hh += 12;
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      hora = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      t = t.replace(h[0], ' ');
      if (!data) data = today;
    }
  }
  return { data, hora, resto: t.replace(/\s+/g, ' ').trim() };
}

/**
 * Devolve os acentos e maiúsculas originais a um trecho normalizado.
 * restoreWords("ligar pro joao", "Me lembra de ligar pro João amanhã") → "ligar pro João"
 */
export function restoreWords(normText, original) {
  const map = new Map();
  for (const raw of String(original || '').split(/\s+/)) {
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const key = normalize(word);
    if (key && !map.has(key)) map.set(key, word);
  }
  return String(normText || '').split(' ').map((w) => map.get(w) || w).join(' ');
}

const has = (t, ...words) => words.some((w) => new RegExp(`(^|\\s)${w}(\\s|$)`).test(t));

/**
 * @param {string} command  texto já sem a palavra de ativação
 * @param {string} today    "YYYY-MM-DD" (data local do computador)
 * @param {string} original frase como foi dita (para devolver acentos e maiúsculas em títulos)
 * @returns {{ intent: string, args?: object }}
 */
export function parseIntent(command, today, original = command) {
  const t = normalize(command);
  if (!t) return { intent: 'chamado' };

  // Saudações
  const greet = t.match(/^(bom dia|boa tarde|boa noite|oi|ola|e ai|opa|fala)( tudo bem| tudo bom| como vai| como voce esta)?$/);
  if (greet) return { intent: 'saudacao', args: { tipo: greet[1] } };

  if (has(t, 'obrigado', 'obrigada', 'valeu', 'brigado')) return { intent: 'agradecimento' };
  if (/^(tchau|ate mais|ate logo|boa noite nano|pode dormir|desliga)$/.test(t)) return { intent: 'despedida' };
  if (/(o que voce (sabe|consegue|pode) fazer|ajuda|quais (sao os )?comandos)/.test(t)) return { intent: 'ajuda' };

  if (/(que horas sao|que hora e|horas agora|me diz a hora)/.test(t)) return { intent: 'hora' };
  if (/(que dia e hoje|qual (e )?a data|que data e hoje|dia de hoje)/.test(t)) return { intent: 'data' };

  // Cobranças (régua)
  if (/(cobranca|cobrancas|quem (nao )?renovou|vencimento|vencimentos|regua)/.test(t)) return { intent: 'cobrancas' };

  // Minhas coisas / resumo do dia
  if (/(minhas coisas|meu dia|o que (eu )?tenho( pra| para)? (hoje|fazer)|minha agenda|meus compromissos|resumo|fala (as )?minhas|me (fala|conta|diz) (o que|as)|como (esta|ta) (o )?meu dia|agenda de hoje)/.test(t)) {
    return { intent: 'minhas_coisas', args: { amanha: /amanha/.test(t) } };
  }
  if (/(minhas tarefas|lista de tarefas|o que falta fazer|tarefas pendentes)/.test(t)) return { intent: 'listar_tarefas' };

  // Música
  if (/^(para|pare|parar|pausa|pausar|desliga|silencio|chega)( a| de)?( musica| som)?$/.test(t) || /(para|pausa|desliga) (a )?musica/.test(t)) {
    return { intent: 'parar_musica' };
  }
  if (/^(proxima|pula|passa|outra)( musica)?$/.test(t) || /(proxima|pula a|passa a|troca a) musica/.test(t)) return { intent: 'proxima_musica' };
  if (/^(continua|volta|retoma|despausa)( a)?( musica)?$/.test(t)) return { intent: 'continuar_musica' };
  if (/^(aumenta|sobe)( o)? (volume|som)/.test(t)) return { intent: 'volume', args: { delta: 0.2 } };
  if (/^(abaixa|diminui|baixa)( o)? (volume|som)/.test(t)) return { intent: 'volume', args: { delta: -0.2 } };
  const music = t.match(/^(?:toca|tocar|toque|coloca|colocar|coloque|bota|botar|bote|poe|por|ponha|solta|soltar|manda)\s+(?:(?:uma|um|a|o|as|os|umas|uns)\s+)?(?:musica|musicas|som|playlist|cancao)?\s*(?:de|do|da|dos|das)?\s*(.*?)\s*(?:no (youtube|spotify))?$/);
  if (music && (/(musica|som|playlist|cancao)/.test(t) || music[1] || music[2])) {
    let consulta = music[1].replace(/\s*no (youtube|spotify)$/, '').trim();
    if (['musica', 'som', 'alguma coisa', 'qualquer coisa', 'algo'].includes(consulta)) consulta = '';
    return { intent: 'tocar_musica', args: { consulta: restoreWords(consulta, original), onde: music[2] || null } };
  }

  // Abrir pasta
  const folder = t.match(/^(?:abre|abrir|abra|mostra|mostrar|vai pra|vai para|entra na|entra no)\s+(?:a |o |minha |meu )?(?:pasta|diretorio)\s*(?:de |do |da |dos |das )?(.+)$/);
  if (folder) return { intent: 'abrir_pasta', args: { nome: stripArticles(folder[1]) } };
  const folderShort = t.match(/^(?:abre|abrir|abra)\s+(?:a |o |os |as |minha |meu |meus |minhas )?(downloads|documentos|area de trabalho|desktop|imagens|fotos|musicas|videos)$/);
  if (folderShort) return { intent: 'abrir_pasta', args: { nome: folderShort[1] } };

  // Abrir site/app
  const site = t.match(/^(?:abre|abrir|abra|entra no|entra na|vai no|vai na)\s+(?:o |a )?(.+)$/);
  if (site) return { intent: 'abrir_site', args: { nome: stripArticles(site[1]) } };

  // Pesquisar
  const search = t.match(/^(?:pesquisa|pesquisar|procura|procurar|busca|buscar|googla|joga no google)\s+(?:sobre |por )?(.+)$/);
  if (search) return { intent: 'pesquisar', args: { consulta: restoreWords(search[1], original) } };

  // Tarefas
  const done = t.match(/^(?:conclui|concluir|conclua|marca como feito|marca como feita|terminei|ja fiz|feito|risca|tira da lista)\s+(?:a tarefa |o |a )?(.+)$/);
  if (done) return { intent: 'concluir_tarefa', args: { texto: done[1] } };
  const task = t.match(/^(?:anota|anotar|anote|adiciona|adicionar|adicione|coloca na lista|poe na lista|nova tarefa|tarefa|lembra de|lembrar de|me lembra de|me lembre de|nao me deixa esquecer de)\s+(?:a tarefa |uma tarefa |na lista )?(.+)$/);
  if (task) {
    const w = parseWhen(task[1], today);
    if (w.hora) return { intent: 'novo_compromisso', args: { titulo: restoreWords(w.resto, original), data: w.data, hora: w.hora } };
    return { intent: 'nova_tarefa', args: { texto: restoreWords(task[1], original) } };
  }
  const appt = t.match(/^(?:marca|marcar|marque|agenda|agendar|agende|cria um compromisso|compromisso)\s+(?:um |uma |o |a )?(?:compromisso )?(.+)$/);
  if (appt) {
    const w = parseWhen(appt[1], today);
    return { intent: 'novo_compromisso', args: { titulo: restoreWords(w.resto, original) || 'compromisso', data: w.data || today, hora: w.hora } };
  }

  return { intent: 'desconhecido', args: { texto: command } };
}
