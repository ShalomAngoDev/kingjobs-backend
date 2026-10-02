import {
  documentTypeCodeFromName,
  isIdentityDocumentTypeCode,
  normalizeDocumentTypeName,
} from './document-type.util';

describe('document-type.util', () => {
  it('generates a stable code from a French label', () => {
    expect(documentTypeCodeFromName('Permis de conduire')).toBe(
      'PERMIS_DE_CONDUIRE',
    );
    expect(documentTypeCodeFromName('Carte professionnelle')).toBe(
      'CARTE_PROFESSIONNELLE',
    );
  });

  it('normalizes names for deduplication', () => {
    expect(normalizeDocumentTypeName('Permis de Conduire')).toBe(
      normalizeDocumentTypeName('permis de conduire'),
    );
  });

  it('detects identity document codes', () => {
    expect(isIdentityDocumentTypeCode('LIVE_SELFIE')).toBe(true);
    expect(isIdentityDocumentTypeCode('DRIVING_LICENSE')).toBe(false);
  });
});
