/** Verifies parsed contact projection preserves manual fields and original phone country context. */
import { candidateFields } from './candidate-fields';
import { candidateProfileSchema } from './schemas';

describe('candidate contact projection', () => {
  it('marks a successfully stored extraction complete in the native candidate table', () => {
    expect(candidateFields({ summary: 'parsed' }).candidateAiStatus).toBe(
      'COMPLETED',
    );
  });
  it('projects an international number into native phone components', () => {
    expect(candidateFields({ phone: '+86 138 0013 8000' }).phones).toEqual({
      primaryPhoneNumber: '13800138000',
      primaryPhoneCallingCode: '+86',
      primaryPhoneCountryCode: 'CN',
      additionalPhones: [],
    });
  });
  it('retains national numbers without guessing a country', () => {
    expect(candidateFields({ phone: '020 7946 0958' }).phones).toMatchObject({
      primaryPhoneNumber: '020 7946 0958',
      primaryPhoneCallingCode: '',
      primaryPhoneCountryCode: '',
    });
  });
  it('retains a parenthesized national number without inventing its country', () => {
    expect(candidateFields({ phone: '(202) 555-0123' }).phones).toMatchObject({
      primaryPhoneNumber: '(202) 555-0123',
      primaryPhoneCallingCode: '',
    });
    expect(candidateFields({ phone: '12' }).phones).toBeUndefined();
  });
  it('does not overwrite a manual primary number or erase it on missing extraction', () => {
    const current = { phones: { primaryPhoneNumber: '12345678' } };
    expect(
      candidateFields({ phone: '+8613800138000' }, current).phones,
    ).toBeUndefined();
    expect(candidateFields({ phone: null }, current).phones).toBeUndefined();
  });
  it('rejects non-web extracted links and accepts historical profiles without urls', () => {
    const links = candidateProfileSchema.shape.urls;
    expect(links.safeParse(['javascript:alert(1)']).success).toBe(false);
    expect(links.safeParse(['https://github.com/example']).success).toBe(true);
    expect(links.safeParse(null).success).toBe(true);
    expect(links.safeParse(undefined).success).toBe(true);
  });
});
