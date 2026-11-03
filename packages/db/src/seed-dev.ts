import { createDatabase } from './client.js';
import {
  ADMIN_CPF,
  ADMIN_EMAIL,
  AGENT_PHONE,
  CITIZEN_PHONE,
  DEMO_UNSERVED_CENTER,
  MANAGER_CPF,
  MANAGER_EMAIL,
  SUPPORT_CPF,
  SUPPORT_EMAIL,
  TENANT_ADMIN_CPF,
  TENANT_ADMIN_EMAIL,
  seedDev,
} from './seed-dev-data.js';

const HELP = `Uso: pnpm db:seed:dev [--reset]

Cria (ou completa) a prefeitura de demonstração. Pode rodar quantas vezes quiser.

  --reset   Volta a demo ao começo: cancela as atividades ativas da demo (as que o agente
            iniciou, concluiu ou relatou impedimento) e cria outras, atribuídas de novo.
            Recria a fila do painel (duas em revisão e uma impedida, com as esperas do
            desenho). Recria a triagem de exemplo que foi tratada no painel e recusa as demais
            ocorrências abertas da prefeitura demo (sobras de junções, separações,
            atribuições e relatos de teste), para o mapa e a triagem voltarem ao desenho.
            Também vale SEED_RESET=1.
  --help    Mostra esta ajuda.

Conexão: DATABASE_OWNER_URL (dono do banco; padrão: o Postgres local do docker compose).`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}
const reset = args.includes('--reset') || process.env.SEED_RESET === '1';

// seedDev exige o dono do banco (superusuário), nunca app_user.
const url =
  process.env.DATABASE_OWNER_URL ?? 'postgres://alocidadao:alocidadao@localhost:5433/alocidadao';

const { db, pool } = createDatabase(url);
try {
  const result = await seedDev(db, { reset });
  if (reset)
    console.log(
      'Demo reiniciada: atividades e triagem de exemplo recriadas; as demais ocorrências abertas foram recusadas.',
    );
  console.log(JSON.stringify(result, null, 2));
  console.log(
    [
      '',
      'Login de desenvolvimento (código: o valor de AUTH_DEV_FIXED_CODE na API)',
      `  App, agente:   ${AGENT_PHONE}`,
      `  App, cidadão:  ${CITIZEN_PHONE}`,
      `  Painel, gestor: CPF ${MANAGER_CPF} (${MANAGER_EMAIL})`,
      `  Painel, admin da prefeitura: CPF ${TENANT_ADMIN_CPF} (${TENANT_ADMIN_EMAIL})`,
      `  Painel, admin interno: CPF ${ADMIN_CPF} (${ADMIN_EMAIL})`,
      `  Painel, suporte interno: CPF ${SUPPORT_CPF} (${SUPPORT_EMAIL})`,
      '',
      'Município sem prefeitura (tela 5c): Senador Canedo (5220454)',
      `  Centro: ${DEMO_UNSERVED_CENTER.lat}, ${DEMO_UNSERVED_CENTER.lng}`,
      `  GPS do emulador Android: adb emu geo fix ${DEMO_UNSERVED_CENTER.lng} ${DEMO_UNSERVED_CENTER.lat}`,
      '',
      'Para voltar as atividades da demo ao começo: pnpm db:seed:dev --reset (ajuda: --help)',
    ].join('\n'),
  );
} finally {
  await pool.end();
}
