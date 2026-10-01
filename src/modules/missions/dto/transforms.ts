import { Transform } from 'class-transformer';

/** Trim des chaînes en entrée (laisse passer les autres types pour la validation). */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

export const UpperCase = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );
