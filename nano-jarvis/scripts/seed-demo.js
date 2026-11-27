// `npm run seed` — cria clientes e proxies FICTÍCIOS (tabelas demo_*) com vencimentos relativos a hoje,
// cobrindo todos os cenários da régua. `npm run seed -- --reset` também apaga o histórico da régua
// (envios, ciclos, execuções, lista "não cobrar") do banco LOCAL. Nunca toca em dados da ProxysEvo.
import { createContext } from '../src/context.js';
import { localDate, addDays } from '../src/dates.js';
import { tx } from '../src/db.js';

const { db, store, config } = createContext();
if (config.source !== 'demo') {
  console.error('Seed só roda com DATA_SOURCE=demo (para nunca misturar com dados reais).');
  process.exit(1);
}
const reset = process.argv.includes('--reset');
const today = localDate(new Date(), config.timezone);
// 15h de São Paulo = 18h UTC (Brasil sem horário de verão).
const at = (offset) => `${addDays(today, offset)}T18:00:00.000Z`;

const clients = [
  // id, nome, email, whatsapp, saldo (centavos), bônus, admin, teste
  ['c1', 'Ana Souza', 'ana@exemplo.com.br', '(11) 98888-0001', 1000, 0, 0, 0],
  ['c2', 'Bruno Lima', 'bruno@exemplo.com.br', '(11) 98888-0002', 10000, 0, 0, 0],
  ['c3', 'Carla Dias', 'carla@exemplo.com.br', '(21) 98888-0003', 0, 0, 0, 0],
  ['c4', 'Admin ProxysEvo', 'admin@exemplo.com.br', '(11) 98888-0004', 0, 0, 1, 0],
  ['c5', 'Conta Teste', 'teste@exemplo.com.br', '(11) 98888-0005', 0, 0, 0, 1],
  ['c6', 'Diego Rocha', 'diego@exemplo.com.br', '(31) 98888-0006', 500, 0, 0, 0],
  ['c7', 'Elisa Martins', 'elisa@exemplo.com.br', '(41) 98888-0007', 0, 0, 0, 0],
  ['c8', 'Fábio Nunes', 'fabio@exemplo.com.br', '(51) 98888-0008', 1790, 0, 0, 0],
  ['c9', 'Gabriela Alves', 'gabi@exemplo.com.br', '(61) 98888-0009', 2000, 0, 0, 0],
  ['c10', 'Hugo Prado', 'hugo@exemplo.com.br', '(71) 98888-0010', 0, 0, 0, 0],
  ['c11', 'Íris Campos', 'iris@exemplo.com.br', '', 0, 0, 0, 0],
  ['c12', 'João Pires', 'joao@exemplo.com.br', '(11) 98888-0012', 1000, 1000, 0, 0],
];
const proxies = [
  // id, cliente, porta, status, vencimento (dias a partir de hoje)
  ['p1', 'c1', 10001, 'active', 3], ['p2', 'c1', 10002, 'active', 3], ['p3', 'c1', 10003, 'active', 3], // D-3, saldo insuficiente
  ['p4', 'c2', 10004, 'active', 7], ['p5', 'c2', 10005, 'active', 7], // saldo suficiente
  ['p6', 'c3', 10006, 'active', 1], // lista "não cobrar"
  ['p7', 'c4', 10007, 'active', 0], // admin
  ['p8', 'c5', 10008, 'active', 3], // teste
  ['p9', 'c6', 10009, 'suspended', -1], ['p10', 'c6', 10010, 'suspended', -1], // D+1 recuperação
  ['p11', 'c7', 10011, 'active', 0], // D0
  ['p12', 'c8', 10012, 'active', 1], // saldo exatamente igual ao necessário
  ['p13', 'c9', 10013, 'active', 2], ['p14', 'c9', 10014, 'active', 5], // saldo cobre o 1º, não os dois
  ['p15', 'c10', 10015, 'active', 10], // fora da janela de 7 dias
  ['p16', 'c11', 10016, 'active', 1], // sem WhatsApp (só e-mail, se o canal e-mail estiver ligado)
  ['p17', 'c12', 10017, 'active', 1], // saldo + bônus = 20,00 cobre
  ['p18', 'c1', 10018, 'cancelled', 3], // cancelado: não entra
];

tx(db, () => {
  db.exec('DELETE FROM demo_proxies; DELETE FROM demo_clients;');
  if (reset) db.exec('DELETE FROM sends; DELETE FROM cycles; DELETE FROM runs; DELETE FROM do_not_charge; DELETE FROM do_not_charge_log;');
  const ic = db.prepare('INSERT INTO demo_clients (id, name, email, whatsapp, balance_cents, bonus_balance_cents, is_admin, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const c of clients) ic.run(...c);
  const ip = db.prepare('INSERT INTO demo_proxies (id, client_id, port, status, expires_at) VALUES (?, ?, ?, ?, ?)');
  for (const [id, client, port, status, offset] of proxies) ip.run(id, client, port, status, at(offset));
});
if (!store.isDoNotCharge('c3')) store.addDoNotCharge({ clientId: 'c3', clientName: 'Carla Dias', reason: 'Combinou pagamento por fora (exemplo)', actor: 'seed' });

console.log(`Dados de demonstração criados para hoje (${today}): ${clients.length} clientes, ${proxies.length} proxies.${reset ? ' Histórico da régua apagado.' : ''}`);
console.log('Próximo passo: `npm start` e abra o painel, ou `npm run regua -- --previa` para ver o que sairia hoje.');
db.close();
