import { describe, expect, it } from 'vitest';
import {
  agentInviteEmail,
  panelInviteEmail,
  staffInviteEmail,
  type InviteLinks,
} from './invites.js';

const links: InviteLinks = {
  panelUrl: 'http://painel.test',
  playStoreUrl: 'http://play.test/app',
  appStoreUrl: 'http://apple.test/app',
};
const noStores: InviteLinks = { panelUrl: links.panelUrl, playStoreUrl: null, appStoreUrl: null };

const panel = () =>
  panelInviteEmail({
    to: 'maria@exemplo.com',
    name: 'Maria Souza',
    tenantName: 'Prefeitura de Goiânia',
    role: 'manager',
    links,
  });
const agent = (l = links) =>
  agentInviteEmail({
    to: 'joao@exemplo.com',
    name: 'João Lima',
    tenantName: 'Prefeitura de Goiânia',
    teamName: 'Iluminação Pública',
    phone: '+5562991234321',
    links: l,
  });
const staff = () =>
  staffInviteEmail({ to: 'eq@exemplo.com', name: 'Ana Dias', platformRole: 'support', links });

describe('panelInviteEmail', () => {
  it('builds the management invite', () => {
    const m = panel();
    expect(m.subject).toBe('Você foi convidado para o painel do Alô Cidadão');
    expect(m.fromName).toBe('Alô Cidadão · Prefeitura de Goiânia');
    expect(m.html).toContain('href="http://painel.test/entrar"');
    expect(m.text).toContain('http://painel.test/entrar');
    expect(m.html).toContain('Entrar no painel');
    expect(m.text).toContain('digite o seu CPF');
    expect(m.text).toContain('Não existe senha');
    expect(m.text).toContain('Olá, Maria.');
    expect(m.text).toContain('Gestor');
  });

  it('names the tenant admin profile', () => {
    const m = panelInviteEmail({
      to: 'a@b.com',
      name: 'Rui',
      tenantName: 'Prefeitura de Goiânia',
      role: 'tenant_admin',
      links,
    });
    expect(m.text).toContain('Administrador da prefeitura');
  });
});

describe('agentInviteEmail', () => {
  it('links both stores and shows the masked phone', () => {
    const m = agent();
    expect(m.html).toContain('href="http://play.test/app"');
    expect(m.html).toContain('href="http://apple.test/app"');
    expect(m.html).toContain('Iluminação Pública');
    expect(m.html).toContain('(62) •••••-4321');
    expect(m.text).toContain('código por SMS');
    expect(m.text).toContain('Não existe senha');
  });

  it('falls back to a store search hint without links', () => {
    const m = agent(noStores);
    expect(m.html).toContain('Procure <b>Alô Cidadão</b> na loja');
    expect(m.html).not.toContain('Baixar');
    expect(m.text).not.toContain('Baixar');
  });
});

describe('entry link', () => {
  it('points the panel and staff buttons to /entrar without a double slash', () => {
    const slash = { ...links, panelUrl: 'http://painel.test/' };
    const panelMail = panelInviteEmail({
      to: 'a@b.com',
      name: 'Ana',
      tenantName: 'Prefeitura',
      role: 'manager',
      links: slash,
    });
    const staffMail = staffInviteEmail({
      to: 'a@b.com',
      name: 'Ana',
      platformRole: 'admin',
      links: slash,
    });
    for (const m of [panelMail, staffMail]) {
      expect(m.html).toContain('href="http://painel.test/entrar"');
      expect(m.text).toContain('http://painel.test/entrar');
    }
  });
});

describe('staffInviteEmail', () => {
  it('builds the staff invite', () => {
    const m = staff();
    expect(m.subject).toBe('Você foi adicionado à equipe do Alô Cidadão');
    expect(m.fromName).toBe('Alô Cidadão');
    expect(m.html).toContain('Entrar no backoffice');
    expect(m.html).toContain('Suporte');
  });
});

describe('invite emails', () => {
  it('escapes the name in the HTML', () => {
    const m = panelInviteEmail({
      to: 'a@b.com',
      name: 'Ana<b>&"x"',
      tenantName: 'Prefeitura <i>&',
      role: 'manager',
      links,
    });
    expect(m.html).toContain('Ana&lt;b&gt;&amp;&quot;x&quot;');
    expect(m.html).toContain('Prefeitura &lt;i&gt;&amp;');
    expect(m.html).not.toContain('<i>');
  });

  it('never offers a password', () => {
    for (const m of [panel(), agent(), staff()]) {
      for (const part of [m.subject, m.text, m.html ?? '']) {
        expect(part).not.toMatch(/senha provisória|crie sua senha|sua senha/i);
      }
    }
  });
});
