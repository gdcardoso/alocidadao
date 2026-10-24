/**
 * Tokens visuais do app do cidadão, copiados do Pencil (docs/superpowers/specs/
 * 2026-10-23-telas-cidadao-pencil.md, seção 3). Sem modo escuro.
 */
export const colors = {
  // Os 22 tokens do arquivo.
  bg: '#F5F7FA',
  surface: '#FFFFFF',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textPlaceholder: '#64748B',
  border: '#E2E8F0',
  borderInput: '#7C8798',
  primary: '#0057B8',
  primaryStrong: '#003F87',
  primarySoft: '#E6EFFA',
  onPrimary: '#FFFFFF',
  success: '#007A4A',
  successSoft: '#E6F5EE',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  danger: '#B91C1C',
  dangerSoft: '#FEE2E2',
  brandGreen: '#009E60',
  brandYellow: '#F2C300',
  onBrandGreen: '#FFFFFF',
  onBrandYellow: '#0F172A',
  brandGreenOnBlue: '#3DDC97',
  // Valores literais usados nas telas.
  openNotice: '#F1F5F9',
  scrim: '#0F172A8C',
  photoOverlay: '#0F172AB3',
  photoGradientEnd: '#0F172AD9',
  glass: '#FFFFFFF2',
  galleryText: '#CBD5E1',
  sheetHandle: '#CBD5E1',
  // Galeria (7): fundo, bordas das fotos vizinhas, botão Fechar e indicadores.
  galleryBg: '#000000',
  galleryEdge: '#334155',
  galleryButton: '#FFFFFF26',
  galleryDot: '#FFFFFF66',
  // Fundos da pilha de fotos.
  photoStackBack: '#94A3B8',
  photoStackMiddle: '#64748B',
} as const;

export type ColorToken = keyof typeof colors;

/** Nomes registrados pelo useFonts (ver fonts.ts). */
export const fonts = {
  heading: 'Lexend_600SemiBold',
  headingMedium: 'Lexend_500Medium',
  body: 'SourceSans3_400Regular',
  bodyMedium: 'SourceSans3_500Medium',
  bodySemibold: 'SourceSans3_600SemiBold',
} as const;

export const radius = { check: 6, digit: 14, field: 16, card: 20, pill: 999 } as const;

export const space = { gutter: 20, gutterAuth: 24, section: 24 } as const;

/** Opacidade de botão desativado no Pencil. */
export const DISABLED_OPACITY = 0.45;
