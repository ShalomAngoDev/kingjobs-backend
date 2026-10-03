/** Templates emails vérification (plain text + HTML simple). Pas de lien app mobile inventé. */

export type VerificationEmailKind = 'approved' | 'needs_changes' | 'rejected';

export function buildVerificationDecisionEmail(input: {
  kind: VerificationEmailKind;
  firstName: string;
  caseKind: 'IDENTITY' | 'JOBBER_PROFILE';
  userMessage?: string | null;
}): { subject: string; text: string; html: string } {
  const name = input.firstName.trim() || 'Bonjour';
  const isJobber = input.caseKind === 'JOBBER_PROFILE';
  const scope = isJobber
    ? 'votre profil Jobber KingJOBS'
    : 'votre identité KingJOBS';

  if (input.kind === 'approved') {
    const subject = isJobber
      ? 'Votre profil a été vérifié'
      : 'Votre identité a été vérifiée';
    const text = [
      `Bonjour ${name},`,
      '',
      `Nous avons examiné ${scope}.`,
      isJobber
        ? 'Votre profil a été vérifié.'
        : 'Votre identité a été vérifiée.',
      '',
      isJobber
        ? 'Vous pouvez désormais candidater aux missions, selon les règles d’éligibilité applicables.'
        : 'Vous pouvez poursuivre la vérification de votre profil Jobber si ce n’est pas déjà fait.',
      '',
      'À bientôt,',
      'L’équipe KingJOBS',
    ].join('\n');
    return { subject, text, html: textToHtml(text) };
  }

  if (input.kind === 'needs_changes') {
    const subject = 'Une action est nécessaire sur votre profil KingJOBS';
    const reason =
      input.userMessage?.trim() ||
      'Des informations doivent être mises à jour.';
    const text = [
      `Bonjour ${name},`,
      '',
      `Nous avons examiné ${scope}.`,
      'Une modification est nécessaire avant que nous puissions finaliser sa vérification.',
      '',
      `Message : ${reason}`,
      '',
      'Vous pouvez mettre à jour votre dossier depuis KingJOBS, puis le soumettre à nouveau.',
      '',
      'À bientôt,',
      'L’équipe KingJOBS',
    ].join('\n');
    return { subject, text, html: textToHtml(text) };
  }

  const subject = 'Mise à jour concernant votre dossier KingJOBS';
  const reason =
    input.userMessage?.trim() ||
    'Votre dossier ne peut pas être validé dans son état actuel.';
  const text = [
    `Bonjour ${name},`,
    '',
    `Nous avons examiné ${scope}.`,
    'Nous ne pouvons pas valider votre dossier pour le moment.',
    '',
    `Message : ${reason}`,
    '',
    'Pour toute question, contactez l’équipe KingJOBS.',
    '',
    'Cordialement,',
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
