import { maskPhone, PLATFORM_ROLE_LABELS, type PlatformRole } from '@alocidadao/shared';
import type { EmailMessage } from './email.js';

export type InviteLinks = {
  panelUrl: string;
  playStoreUrl: string | null;
  appStoreUrl: string | null;
};

const BRAND = '#0057b8';
const BUTTON = '#009e60';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Endereço da tela de entrada do painel, sem barra dupla. */
const entryUrl = (links: InviteLinks) => `${links.panelUrl.replace(/\/+$/, '')}/entrar`;

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function button(label: string, href: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${BUTTON};color:#ffffff;padding:11px 20px;border-radius:8px;font-weight:bold;text-decoration:none;margin:4px">${escapeHtml(label)}</a>`;
}

/** Cartão do mockup B: faixa azul, corpo branco sobre fundo cinza, rodapé discreto. */
function layout({ headerSuffix, paragraphs }: { headerSuffix?: string; paragraphs: string[] }) {
  const suffix = headerSuffix
    ? ` <span style="font-weight:normal;font-size:13px;opacity:.85">· ${escapeHtml(headerSuffix)}</span>`
    : '';
  const body = paragraphs
    .map((p) => (p.startsWith('<') ? p : `<p style="margin:0 0 14px">${p}</p>`))
    .join('');
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#f1f5f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:20px 0">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#0f172a">
<tr><td style="background:${BRAND};color:#ffffff;padding:16px 20px;font-weight:bold;font-size:17px">Alô Cidadão${suffix}</td></tr>
<tr><td style="padding:20px">${body}<p style="margin:0;color:#64748b;font-size:12px">Se você não esperava este convite, ignore este e-mail.</p></td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

const centered = (inner: string) => `<p style="text-align:center;margin:20px 0">${inner}</p>`;
const FOOTER_TEXT = 'Se você não esperava este convite, ignore este e-mail.';
const LOGIN_TEXT =
  'Na tela de entrada, digite o seu CPF. Enviaremos um código para este e-mail. Não existe senha: a cada acesso você recebe um código novo.';

/** Convite de gestão: admin da prefeitura e gestor. */
export function panelInviteEmail(p: {
  to: string;
  name: string;
  tenantName: string;
  role: 'tenant_admin' | 'manager';
  links: InviteLinks;
}): EmailMessage {
  const greeting = `Olá, ${firstName(p.name)}.`;
  const profile = p.role === 'tenant_admin' ? 'Administrador da prefeitura' : 'Gestor';
  const intro = (esc: (s: string) => string, bold: (s: string) => string) =>
    `A ${esc(p.tenantName)} cadastrou você no Alô Cidadão, o sistema que recebe e acompanha as solicitações dos moradores, com o perfil ${bold(esc(profile))}.`;
  const text = [
    greeting,
    intro(
      (s) => s,
      (s) => s,
    ),
    `Entrar no painel: ${entryUrl(p.links)}`,
    LOGIN_TEXT,
    FOOTER_TEXT,
  ].join('\n\n');
  const html = layout({
    headerSuffix: p.tenantName,
    paragraphs: [
      escapeHtml(greeting),
      intro(escapeHtml, (s) => `<b>${s}</b>`),
      centered(button('Entrar no painel', entryUrl(p.links))),
      LOGIN_TEXT,
    ],
  });
  return {
    to: p.to,
    subject: 'Você foi convidado para o painel do Alô Cidadão',
    fromName: `Alô Cidadão · ${p.tenantName}`,
    text,
    html,
  };
}

/** Convite do agente: baixar o app e entrar com o celular. */
export function agentInviteEmail(p: {
  to: string;
  name: string;
  tenantName: string;
  teamName: string;
  phone: string;
  links: InviteLinks;
}): EmailMessage {
  const greeting = `Olá, ${firstName(p.name)}.`;
  const phone = maskPhone(p.phone);
  const intro = (esc: (s: string) => string, bold: (s: string) => string) =>
    `A ${esc(p.tenantName)} cadastrou você como agente da equipe ${bold(esc(p.teamName))} no Alô Cidadão. Pelo app, você recebe as solicitações dos moradores e registra o atendimento.`;
  const after = `Depois de instalar, abra o app e digite o seu celular ${phone}. Você recebe um código pelo WhatsApp. Não existe senha. O app já abre na sua lista de atividades.`;

  const stores: { label: string; href: string }[] = [];
  if (p.links.playStoreUrl)
    stores.push({ label: 'Baixar no Google Play', href: p.links.playStoreUrl });
  if (p.links.appStoreUrl) stores.push({ label: 'Baixar na App Store', href: p.links.appStoreUrl });

  const text = [
    greeting,
    intro(
      (s) => s,
      (s) => s,
    ),
    stores.length > 0
      ? stores.map((s) => `${s.label}: ${s.href}`).join('\n')
      : 'Procure Alô Cidadão na loja de aplicativos do seu celular.',
    after,
    FOOTER_TEXT,
  ].join('\n\n');
  const html = layout({
    headerSuffix: p.tenantName,
    paragraphs: [
      escapeHtml(greeting),
      intro(escapeHtml, (s) => `<b>${s}</b>`),
      stores.length > 0
        ? centered(stores.map((s) => button(s.label, s.href)).join(''))
        : '<p style="margin:0 0 14px">Procure <b>Alô Cidadão</b> na loja de aplicativos do seu celular.</p>',
      escapeHtml(after),
    ],
  });
  return {
    to: p.to,
    subject: 'Você foi convidado para o app do agente do Alô Cidadão',
    fromName: `Alô Cidadão · ${p.tenantName}`,
    text,
    html,
  };
}

/** Convite da equipe Alô Cidadão (backoffice). */
export function staffInviteEmail(p: {
  to: string;
  name: string;
  platformRole: PlatformRole;
  links: InviteLinks;
}): EmailMessage {
  const greeting = `Olá, ${firstName(p.name)}.`;
  const role = PLATFORM_ROLE_LABELS[p.platformRole];
  const text = [
    greeting,
    `Você foi adicionado à equipe do Alô Cidadão com o papel ${role}.`,
    `Entrar no backoffice: ${entryUrl(p.links)}`,
    LOGIN_TEXT,
    FOOTER_TEXT,
  ].join('\n\n');
  const html = layout({
    paragraphs: [
      escapeHtml(greeting),
      `Você foi adicionado à equipe do Alô Cidadão com o papel <b>${escapeHtml(role)}</b>.`,
      centered(button('Entrar no backoffice', entryUrl(p.links))),
      LOGIN_TEXT,
    ],
  });
  return {
    to: p.to,
    subject: 'Você foi adicionado à equipe do Alô Cidadão',
    fromName: 'Alô Cidadão',
    text,
    html,
  };
}
