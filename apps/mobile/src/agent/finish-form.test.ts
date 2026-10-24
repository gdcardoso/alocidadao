import type { DeviceLocation, GeoPoint } from '@alocidadao/shared';
import { describe, expect, it } from 'vitest';
import {
  canSendCompletion,
  canSendImpediment,
  hasDraft,
  infoText,
  locationBand,
} from './finish-form';

const SITE: GeoPoint = { lat: -23.5505, lng: -46.6333 };
/** Ponto a `m` metros ao norte do local. */
const north = (m: number): DeviceLocation => ({
  lat: SITE.lat + m / 111_195.08,
  lng: SITE.lng,
  accuracyM: 5,
});

describe('locationBand', () => {
  it('near the site shows success with the distance', () => {
    expect(locationBand(north(8), SITE)).toEqual({
      tone: 'success',
      icon: 'map-pin-check',
      text: 'Você está no local da ocorrência (a 8 m)',
    });
    // Perto do limite ainda está no local.
    expect(locationBand(north(99), SITE).tone).toBe('success');
  });

  it('far from the site warns without blocking', () => {
    expect(locationBand(north(1200), SITE)).toEqual({
      tone: 'warning',
      icon: 'map-pin-x',
      text: 'Você está a 1,2 km do local da ocorrência. Pode concluir assim mesmo.',
    });
    expect(locationBand(north(150), SITE).text).toBe(
      'Você está a 150 m do local da ocorrência. Pode concluir assim mesmo.',
    );
  });

  it('unknown location warns without blocking', () => {
    expect(locationBand(null, SITE)).toEqual({
      tone: 'warning',
      icon: 'map-pin-off',
      text: 'Não foi possível confirmar sua localização. Pode concluir assim mesmo.',
    });
  });

  it('reading the location shows a neutral band', () => {
    expect(locationBand('reading', SITE)).toEqual({
      tone: 'neutral',
      icon: 'loading',
      text: 'Confirmando sua localização…',
    });
  });
});

describe('send rules', () => {
  it('completion needs one to three photos and a note', () => {
    const one = ['a.jpg'];
    expect(canSendCompletion({ photos: [], note: 'Buraco tapado' })).toBe(false);
    expect(canSendCompletion({ photos: one, note: '' })).toBe(false);
    expect(canSendCompletion({ photos: one, note: '  ab  ' })).toBe(false);
    expect(canSendCompletion({ photos: one, note: 'abc' })).toBe(true);
    expect(canSendCompletion({ photos: ['a', 'b', 'c'], note: 'Buraco tapado' })).toBe(true);
    expect(canSendCompletion({ photos: ['a', 'b', 'c', 'd'], note: 'Buraco tapado' })).toBe(false);
    expect(canSendCompletion({ photos: one, note: 'x'.repeat(2001) })).toBe(false);
  });

  it('impediment needs a reason and a note and allows one photo', () => {
    const base = { reason: 'inaccessible' as const, note: 'Rua fechada', photos: [] };
    expect(canSendImpediment(base)).toBe(true);
    expect(canSendImpediment({ ...base, photos: ['a.jpg'] })).toBe(true);
    expect(canSendImpediment({ ...base, photos: ['a.jpg', 'b.jpg'] })).toBe(false);
    expect(canSendImpediment({ ...base, reason: null })).toBe(false);
    expect(canSendImpediment({ ...base, note: ' ab ' })).toBe(false);
    expect(canSendImpediment({ ...base, note: 'x'.repeat(1001) })).toBe(false);
  });
});

describe('infoText', () => {
  it('info text uses singular for one citizen', () => {
    expect(infoText(1)).toBe(
      'O gestor revisa as fotos e o relato antes de enviar ao cidadão que relatou.',
    );
    expect(infoText(6)).toBe(
      'O gestor revisa as fotos e o relato antes de enviar aos 6 cidadãos que relataram.',
    );
  });

  it('info text without active citizens only mentions the review', () => {
    expect(infoText(0)).toBe('O gestor revisa as fotos e o relato.');
  });
});

describe('hasDraft', () => {
  it('an empty form has no draft', () => {
    expect(hasDraft({ photos: [], note: '  ' })).toBe(false);
    expect(hasDraft({ photos: [], note: '', reason: null })).toBe(false);
  });

  it('a photo, a note or a reason is a draft', () => {
    expect(hasDraft({ photos: ['a.jpg'], note: '' })).toBe(true);
    expect(hasDraft({ photos: [], note: 'Rua fechada' })).toBe(true);
    expect(hasDraft({ photos: [], note: '', reason: 'other' })).toBe(true);
  });

  it('the untouched previous note of a rework is not a draft', () => {
    const initialNote = 'Buraco tapado';
    expect(hasDraft({ photos: [], note: 'Buraco tapado', initialNote })).toBe(false);
    expect(hasDraft({ photos: [], note: 'Buraco tapado de novo', initialNote })).toBe(true);
    expect(hasDraft({ photos: [], note: '', initialNote })).toBe(true);
  });
});
