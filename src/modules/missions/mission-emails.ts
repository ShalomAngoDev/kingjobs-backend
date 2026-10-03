/** Emails transactionnels revue mission (BO04). Pas de lien app mobile inventé. */

export type MissionReviewEmailKind = 'approved' | 'needs_changes' | 'rejected';

export function buildMissionReviewEmail(input: {
  kind: MissionReviewEmailKind;
  firstName: string;
  missionTitle: string;
  userMessage?: string | null;
  /** Si true : paiement confirmé, refund futur (ne jamais dire « remboursé »). */
  paymentConfirmed?: boolean;
}): { subject: string; text: string; html: string } {
  const name = input.firstName.trim() || 'Bonjour';
  const title = input.missionTitle.trim() || 'Votre mission';

  if (input.kind === 'approved') {
    const subject = 'Votre mission KingJOBS est publiée';
    const text = [
      `Bonjour ${name},`,
      '',
      'Votre mission :',
      `"${title}"`,
      '',
      'a été validée par notre équipe et est maintenant publiée sur KingJOBS.',
      'Les Jobbers éligibles peuvent désormais la consulter et candidater.',
      '',
      'L’équipe KingJOBS',
    ].join('\n');
    return { subject, text, html: textToHtml(text) };
  }

  if (input.kind === 'needs_changes') {
    const subject =
      'Une modification est nécessaire pour votre mission KingJOBS';
    const reason =
      input.userMessage?.trim() ||
      'Des informations doivent être complétées avant publication.';
    const text = [
      `Bonjour ${name},`,
      '',
      'Une modification est nécessaire avant la publication de votre mission.',
      '',
      `Mission : "${title}"`,
      '',
      `Message : ${reason}`,
      '',
      'Vous pouvez corriger votre mission depuis KingJOBS, puis la soumettre à nouveau.',
      '',
      'L’équipe KingJOBS',
    ].join('\n');
    return { subject, text, html: textToHtml(text) };
  }

  const subject = 'Mise à jour concernant votre mission KingJOBS';
  const reason =
    input.userMessage?.trim() ||
    'Nous ne pouvons pas publier votre mission dans son état actuel.';
  const financialNote = input.paymentConfirmed
    ? [
        '',
        'Si un paiement a été effectué pour cette mission, son traitement financier sera pris en charge conformément au processus KingJOBS.',
      ]
    : [];
  const text = [
    `Bonjour ${name},`,
    '',
    `Mission : "${title}"`,
    '',
    'Votre mission ne peut pas être publiée.',
    '',
    reason,
    ...financialNote,
    '',
    'Pour toute question, contactez l’équipe KingJOBS.',
    '',
    'Cordialement,',
    'L’équipe KingJOBS',
  ].join('\n');
  return { subject, text, html: textToHtml(text) };
}

/** BO05 — nouvelle candidature (Client). V1 : 1 email / candidature, pas de digest. */
export function buildApplicationReceivedClientEmail(input: {
  clientFirstName: string;
  missionTitle: string;
  missionReference: string;
}): { subject: string; text: string; html: string } {
  const name = input.clientFirstName.trim() || 'Bonjour';
  const subject = 'Nouvelle candidature sur votre mission KingJOBS';
  const text = [
    `Bonjour ${name},`,
    '',
    'Une nouvelle candidature a été reçue pour votre mission.',
    '',
    `Mission : "${input.missionTitle}" (${input.missionReference})`,
    '',
    'Connectez-vous à KingJOBS pour consulter le profil et sélectionner vos Jobbers.',
    '',
    'L’équipe KingJOBS',
  ].join('\n');
  return { subject, text, html: textToHtml(text) };
}

/** BO05 — Jobber sélectionné. */
export function buildApplicationSelectedJobberEmail(input: {
  jobberFirstName: string;
  missionTitle: string;
  city: string;
  district: string | null;
  scheduledStartAt: Date | null;
  workerGrossAmount: number;
  currency: string;
}): { subject: string; text: string; html: string } {
  const name = input.jobberFirstName.trim() || 'Bonjour';
  const zone = [input.district, input.city].filter(Boolean).join(', ');
  const when = input.scheduledStartAt
    ? input.scheduledStartAt.toLocaleString('fr-FR', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'à confirmer';
  const amount = `${input.workerGrossAmount.toLocaleString('fr-FR')} ${
    input.currency === 'XOF' ? 'FCFA' : input.currency
  }`;
  const subject = `Vous avez été sélectionné — ${input.missionTitle}`;
  const text = [
    `Bonjour ${name},`,
    '',
    `Vous avez été sélectionné pour la mission « ${input.missionTitle} ».`,
    '',
    `Zone : ${zone || 'à confirmer'}`,
    `Date : ${when}`,
    `Rémunération brute estimée : ${amount}`,
    '',
    'Les détails précis de localisation vous seront communiqués selon le déroulement de la mission.',
    '',
    'L’équipe KingJOBS',
  ].join('\n');
  return { subject, text, html: textToHtml(text) };
}

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escaped}</pre>`;
}
