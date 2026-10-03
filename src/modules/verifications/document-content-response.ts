import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { DocumentContent } from './verifications.service';

/** Flux binaire d'un document privé : jamais mis en cache, jamais interprété par le navigateur. */
export function toDocumentResponse(
  content: DocumentContent,
  res: Response,
): StreamableFile {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  // Pas de `length` fixe : évite Content-Length ≠ octets réels (proxy BFF).
  return new StreamableFile(content.stream, {
    type: content.mimeType,
    disposition: `inline; filename*=UTF-8''${encodeURIComponent(content.filename)}`,
  });
}
