import { randomInt, randomUUID } from 'node:crypto';
import { createDatabase, schema } from '@alocidadao/db';
import { eq, sql } from 'drizzle-orm';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { EmailMessage } from '../messaging/email.js';
import { staffAuthHeader } from '../test/panel.js';
import { panelFixtures } from '../test/panel-fixtures.js';
import { testAuthOptions } from '../test/session.js';
import { API_TEST_APP_URL, API_TEST_OWNER_URL } from '../test/urls.js';
import { registerBackofficeRoutes } from './routes.js';

const { users, staffAuditEvents, municipalities, cityInterest } = schema;

const owner = createDatabase(API_TEST_OWNER_URL);
const appDb = createDatabase(API_TEST_APP_URL);
const fx = panelFixtures(owner.db);

const emailsSent: EmailMessage[] = [];

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({
    database: appDb.db,
    auth: { ...testAuthOptions, email: { send: async (msg) => void emailsSent.push(msg) } },
  });
});

afterAll(async () => {
  await app.close();
  await owner.pool.end();
  await appDb.pool.end();
});

/** CPF válido e aleatório (dígitos verificadores calculados). */
function newCpf(): string {
  const digits = Array.from({ length: 9 }, () => randomInt(0, 10));
  for (const length of [9, 10]) {
    const sum = digits.reduce((acc, d, i) => acc + d * (length + 1 - i), 0);
    digits.push(((sum * 10) % 11) % 10);
  }
  const cpf = digits.join('');
  return /^(.)\1{10}$/.test(cpf) ? newCpf() : cpf;
}

const newEmail = () => `auditoria.${randomUUID()}@teste.dev`;
const newPhone = () => `+55519${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

async function newMunicipality(name: string) {
  const ibgeCode = String(randomInt(1_000_000, 9_999_999));
  await owner.db.insert(municipalities).values({
    ibgeCode,
    name,
    state: 'BA',
    boundary: sql`ST_Multi(ST_MakeEnvelope(-42.6, -12.6, -42.4, -12.4, 4326))`,
  });
  return ibgeCode;
}

async function frozenAccount() {
  const cpf = newCpf();
  const email = newEmail();
  const [user] = await owner.db
    .insert(users)
    .values({ name: 'Conta Congelada', phone: newPhone(), cpf, email, accountStatus: 'frozen' })
    .returning();
  return { id: user!.id, cpf, email };
}

/** Rotas de escrita (método diferente de GET) registradas no backoffice. */
async function backofficeWriteRoutes(): Promise<string[]> {
  const routes: string[] = [];
  const probe = Fastify().withTypeProvider<ZodTypeProvider>();
  probe.setValidatorCompiler(validatorCompiler);
  probe.setSerializerCompiler(serializerCompiler);
  probe.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method !== 'GET' && method !== 'HEAD') routes.push(`${method} ${route.url}`);
    }
  });
  registerBackofficeRoutes(probe, {
    db: appDb.db,
    secret: testAuthOptions.secret,
    email: testAuthOptions.email,
  });
  await probe.ready();
  await probe.close();
  return routes;
}

type Call = { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; payload?: object };
/** Uma chamada que dá certo, e os dados pessoais que ela leva (não podem ir para `details`). */
type Scenario = { call: Call; personal: string[] };

/**
 * Enviar o código não altera dados (só emite o desafio, com limite de envio por e-mail): não grava
 * auditoria. A recuperação com esse código é que grava `account.recover`.
 */
const NOT_AUDITED = ['POST /backoffice/frozen-accounts/recovery-code'];

/** Para cada rota de escrita, monta os dados e devolve uma chamada válida. */
const SCENARIOS: Record<string, (staffId: string) => Promise<Scenario>> = {
  'POST /backoffice/tenants': async () => {
    const ibgeCode = await newMunicipality('Cidade Auditada');
    const admin = { name: 'Maria Admin', cpf: newCpf(), email: newEmail() };
    return {
      call: {
        method: 'POST',
        url: '/backoffice/tenants',
        payload: {
          ibgeCode,
          displayName: 'Prefeitura Auditada',
          centralPhone: '156',
          admin,
          contract: {
            plan: 'essential',
            includedPanelUsers: 5,
            startsOn: '2026-11-01',
            endsOn: null,
          },
          copyDefaultCatalog: true,
        },
      },
      personal: [admin.name, admin.cpf, admin.email],
    };
  },
  'POST /backoffice/tenants/:id/status': async () => {
    const tenantId = await fx.createTenant('active');
    return {
      call: {
        method: 'POST',
        url: `/backoffice/tenants/${tenantId}/status`,
        payload: { action: 'suspend' },
      },
      personal: [],
    };
  },
  'POST /backoffice/tenants/:id/support/enter': async () => {
    const tenantId = await fx.createTenant('active');
    return {
      call: { method: 'POST', url: `/backoffice/tenants/${tenantId}/support/enter` },
      personal: [],
    };
  },
  'POST /backoffice/tenants/:id/support/leave': async () => {
    const tenantId = await fx.createTenant('active');
    return {
      call: { method: 'POST', url: `/backoffice/tenants/${tenantId}/support/leave` },
      personal: [],
    };
  },
  'PUT /backoffice/city-interest/:ibgeCode/status': async () => {
    const ibgeCode = await newMunicipality('Cidade Interessada');
    await owner.db
      .insert(cityInterest)
      .values({ ibgeCode, userId: await fx.createUser('Cidadão') });
    return {
      call: {
        method: 'PUT',
        url: `/backoffice/city-interest/${ibgeCode}/status`,
        payload: { status: 'contacted' },
      },
      personal: [],
    };
  },
  'POST /backoffice/staff': async () => {
    const person = { name: 'Pessoa Nova', cpf: newCpf(), email: newEmail() };
    return {
      call: {
        method: 'POST',
        url: '/backoffice/staff',
        payload: { ...person, platformRole: 'support' },
      },
      personal: [person.name, person.cpf, person.email],
    };
  },
  'PATCH /backoffice/staff/:userId': async () => {
    const target = await fx.newStaff('support');
    const email = newEmail();
    return {
      call: {
        method: 'PATCH',
        url: `/backoffice/staff/${target}`,
        payload: { name: 'Nome Trocado', email },
      },
      personal: ['Nome Trocado', email],
    };
  },
  'DELETE /backoffice/staff/:userId': async () => {
    const target = await fx.newStaff('support');
    return { call: { method: 'DELETE', url: `/backoffice/staff/${target}` }, personal: [] };
  },
  'POST /backoffice/frozen-accounts/recover': async (staffId) => {
    const frozen = await frozenAccount();
    const sent = await app.inject({
      method: 'POST',
      url: '/backoffice/frozen-accounts/recovery-code',
      headers: await staffAuthHeader(appDb.db, staffId),
      payload: { cpf: frozen.cpf, tenantId: null },
    });
    expect(sent.statusCode).toBe(200);
    const message = emailsSent.findLast((m) => m.to === frozen.email)!;
    const code = /(\d{6})/.exec(message.text)![1]!;
    const email = newEmail();
    return {
      call: {
        method: 'POST',
        url: '/backoffice/frozen-accounts/recover',
        payload: { challengeId: sent.json().challengeId, code, email, tenantId: null },
      },
      personal: [frozen.cpf, frozen.email, email, code],
    };
  },
  'POST /backoffice/frozen-accounts/release-cpf': async () => {
    const frozen = await frozenAccount();
    return {
      call: {
        method: 'POST',
        url: '/backoffice/frozen-accounts/release-cpf',
        payload: { cpf: frozen.cpf, tenantId: null },
      },
      personal: [frozen.cpf, frozen.email],
    };
  },
};

const ALLOWED_DETAIL_KEYS = ['route', 'ibgeCode', 'reason'];

describe('auditoria das rotas do backoffice', () => {
  it('every backoffice write route records an audit event without personal data', async () => {
    const routes = await backofficeWriteRoutes();
    expect(routes.length).toBeGreaterThan(0);
    // Cada rota de escrita tem cenário (ou está na lista das que não gravam), e nada sobra.
    expect(routes.filter((r) => !(r in SCENARIOS) && !NOT_AUDITED.includes(r))).toEqual([]);
    expect([...Object.keys(SCENARIOS), ...NOT_AUDITED].toSorted()).toEqual(routes.toSorted());

    for (const [route, scenario] of Object.entries(SCENARIOS)) {
      // Uma pessoa da equipe por rota: as linhas dela são só desta chamada.
      const staffId = await fx.newStaff('admin', 'Admin da Auditoria');
      const { call, personal } = await scenario(staffId);
      const before = await owner.db
        .select()
        .from(staffAuditEvents)
        .where(eq(staffAuditEvents.staffUserId, staffId));
      const response = await app.inject({
        ...call,
        headers: await staffAuthHeader(appDb.db, staffId),
      });
      expect(response.statusCode, `${route}: ${response.body}`).toBeLessThan(300);

      const after = await owner.db
        .select()
        .from(staffAuditEvents)
        .where(eq(staffAuditEvents.staffUserId, staffId));
      const written = after.filter((row) => !before.some((b) => b.id === row.id));
      expect(written.length, route).toBeGreaterThan(0);
      for (const row of written) {
        const details = (row.details ?? {}) as Record<string, unknown>;
        expect(
          Object.keys(details).filter((key) => !ALLOWED_DETAIL_KEYS.includes(key)),
          route,
        ).toEqual([]);
        const serialized = JSON.stringify(row.details).toLowerCase();
        for (const value of [...personal, 'Admin da Auditoria']) {
          expect(serialized, route).not.toContain(value.toLowerCase());
        }
      }
    }
  });
});
