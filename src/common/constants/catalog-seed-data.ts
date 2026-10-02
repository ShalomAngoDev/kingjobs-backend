/**
 * Catalogue officiel KingJOBS V1 — source de vérité seed.
 * 8 catégories / 40 services. Slugs stables (idempotence).
 */
export type CatalogCategorySeed = {
  slug: string;
  name: string;
  description: string;
  displayOrder: number;
};

export type CatalogServiceSeed = {
  slug: string;
  name: string;
  categorySlug: string;
  shortDescription: string;
  displayOrder: number;
  minimumAge: number;
};

export const CATALOG_CATEGORY_SEEDS: CatalogCategorySeed[] = [
  {
    slug: 'maison-entretien',
    name: 'Maison & Entretien',
    description: 'Entretien du domicile et jardin.',
    displayOrder: 1,
  },
  {
    slug: 'travaux-reparations',
    name: 'Travaux & Réparations',
    description: 'Petits travaux, réparations et interventions techniques.',
    displayOrder: 2,
  },
  {
    slug: 'transport-logistique',
    name: 'Transport & Logistique',
    description: 'Livraison, déplacement et manutention.',
    displayOrder: 3,
  },
  {
    slug: 'evenements-creatif',
    name: 'Événements & Créatif',
    description: 'Création, animation et services événementiels.',
    displayOrder: 4,
  },
  {
    slug: 'beaute-bien-etre',
    name: 'Beauté & Bien-être',
    description: 'Soins esthétiques et bien-être.',
    displayOrder: 5,
  },
  {
    slug: 'famille-accompagnement',
    name: 'Famille & Accompagnement',
    description: 'Accompagnement familial et éducatif.',
    displayOrder: 6,
  },
  {
    slug: 'accueil-surveillance-commerce',
    name: 'Accueil, Surveillance & Commerce',
    description: 'Accueil, commerce et surveillance.',
    displayOrder: 7,
  },
  {
    slug: 'auto-depannage',
    name: 'Auto & Dépannage',
    description: 'Lavage, mécanique, dépannage et pneus.',
    displayOrder: 8,
  },
];

export const CATALOG_SERVICE_SEEDS: CatalogServiceSeed[] = [
  // Maison & Entretien
  {
    slug: 'menage',
    name: 'Ménage',
    categorySlug: 'maison-entretien',
    shortDescription: 'Nettoyage et entretien intérieur.',
    displayOrder: 1,
    minimumAge: 16,
  },
  {
    slug: 'domestique',
    name: 'Domestique',
    categorySlug: 'maison-entretien',
    shortDescription: 'Aide domestique au domicile.',
    displayOrder: 2,
    minimumAge: 16,
  },
  {
    slug: 'jardinage',
    name: 'Jardinage',
    categorySlug: 'maison-entretien',
    shortDescription: 'Entretien d’espaces verts.',
    displayOrder: 3,
    minimumAge: 16,
  },
  {
    slug: 'cuisine',
    name: 'Cuisine',
    categorySlug: 'maison-entretien',
    shortDescription: 'Préparation de repas.',
    displayOrder: 4,
    minimumAge: 16,
  },
  // Travaux & Réparations
  {
    slug: 'plomberie',
    name: 'Plomberie',
    categorySlug: 'travaux-reparations',
    shortDescription: 'Installation et dépannage sanitaire.',
    displayOrder: 1,
    minimumAge: 16,
  },
  {
    slug: 'electricite',
    name: 'Électricité',
    categorySlug: 'travaux-reparations',
    shortDescription: 'Interventions électriques courantes.',
    displayOrder: 2,
    minimumAge: 16,
  },
  {
    slug: 'technicien',
    name: 'Technicien',
    categorySlug: 'travaux-reparations',
    shortDescription: 'Interventions techniques générales.',
    displayOrder: 3,
    minimumAge: 16,
  },
  {
    slug: 'peinture',
    name: 'Peinture',
    categorySlug: 'travaux-reparations',
    shortDescription: 'Peinture intérieure et extérieure.',
    displayOrder: 4,
    minimumAge: 16,
  },
  {
    slug: 'maconnerie',
    name: 'Maçonnerie',
    categorySlug: 'travaux-reparations',
    shortDescription: 'Travaux de maçonnerie.',
    displayOrder: 5,
    minimumAge: 16,
  },
  {
    slug: 'carrelage',
    name: 'Carrelage',
    categorySlug: 'travaux-reparations',
    shortDescription: 'Pose et réparation de carrelage.',
    displayOrder: 6,
    minimumAge: 16,
  },
  {
    slug: 'menuiserie',
    name: 'Menuiserie',
    categorySlug: 'travaux-reparations',
    shortDescription: 'Travaux de menuiserie.',
    displayOrder: 7,
    minimumAge: 16,
  },
  {
    slug: 'soudure',
    name: 'Soudure',
    categorySlug: 'travaux-reparations',
    shortDescription: 'Travaux de soudure.',
    displayOrder: 8,
    minimumAge: 16,
  },
  {
    slug: 'vitrerie',
    name: 'Vitrerie',
    categorySlug: 'travaux-reparations',
    shortDescription: 'Pose et réparation de vitrages.',
    displayOrder: 9,
    minimumAge: 16,
  },
  // Transport & Logistique
  {
    slug: 'livraison',
    name: 'Livraison',
    categorySlug: 'transport-logistique',
    shortDescription: 'Livraison de colis et courses.',
    displayOrder: 1,
    minimumAge: 16,
  },
  {
    slug: 'chauffeur',
    name: 'Chauffeur',
    categorySlug: 'transport-logistique',
    shortDescription: 'Conduite et déplacement.',
    displayOrder: 2,
    minimumAge: 18,
  },
  {
    slug: 'manutention',
    name: 'Manutention',
    categorySlug: 'transport-logistique',
    shortDescription: 'Chargement et manutention.',
    displayOrder: 3,
    minimumAge: 16,
  },
  // Événements & Créatif
  {
    slug: 'photographie',
    name: 'Photographie',
    categorySlug: 'evenements-creatif',
    shortDescription: 'Prise de vue et reportage photo.',
    displayOrder: 1,
    minimumAge: 16,
  },
  {
    slug: 'service-traiteur',
    name: 'Service traiteur',
    categorySlug: 'evenements-creatif',
    shortDescription: 'Service traiteur pour événements.',
    displayOrder: 2,
    minimumAge: 16,
  },
  {
    slug: 'dj',
    name: 'DJ',
    categorySlug: 'evenements-creatif',
    shortDescription: 'Animation musicale.',
    displayOrder: 3,
    minimumAge: 16,
  },
  {
    slug: 'decoration',
    name: 'Décoration',
    categorySlug: 'evenements-creatif',
    shortDescription: 'Décoration d’espaces et d’événements.',
    displayOrder: 4,
    minimumAge: 16,
  },
  {
    slug: 'nettoyage-evenementiel',
    name: 'Personnel de nettoyage événementiel',
    categorySlug: 'evenements-creatif',
    shortDescription:
      'Nettoyage et remise en état des espaces avant, pendant et après un événement.',
    displayOrder: 5,
    minimumAge: 16,
  },
  {
    slug: 'montage-demontage-evenementiel',
    name: 'Montage & démontage événementiel',
    categorySlug: 'evenements-creatif',
    shortDescription:
      'Installation et démontage de mobilier, stands et aménagements légers pour événements.',
    displayOrder: 6,
    minimumAge: 18,
  },
  {
    slug: 'technicien-evenementiel',
    name: 'Technicien événementiel',
    categorySlug: 'evenements-creatif',
    shortDescription:
      "Assistance technique pour l'installation, l'exploitation ou le démontage d'équipements événementiels selon les compétences requises.",
    displayOrder: 7,
    minimumAge: 18,
  },
  {
    slug: 'agent-accueil-evenementiel',
    name: "Agent d'accueil événementiel",
    categorySlug: 'evenements-creatif',
    shortDescription:
      "Accueil, orientation et accompagnement du public lors d'événements.",
    displayOrder: 8,
    minimumAge: 16,
  },
  {
    slug: 'personnel-evenementiel-polyvalent',
    name: 'Personnel événementiel polyvalent',
    categorySlug: 'evenements-creatif',
    shortDescription:
      "Renfort polyvalent pour aider à la préparation, au déroulement ou au rangement d'un événement.",
    displayOrder: 9,
    minimumAge: 16,
  },
  // Beauté & Bien-être
  {
    slug: 'coiffure',
    name: 'Coiffure',
    categorySlug: 'beaute-bien-etre',
    shortDescription: 'Coiffure à domicile ou sur site.',
    displayOrder: 1,
    minimumAge: 16,
  },
  {
    slug: 'maquillage',
    name: 'Maquillage',
    categorySlug: 'beaute-bien-etre',
    shortDescription: 'Maquillage événementiel ou quotidien.',
    displayOrder: 2,
    minimumAge: 16,
  },
  {
    slug: 'massage',
    name: 'Massage',
    categorySlug: 'beaute-bien-etre',
    shortDescription: 'Massage bien-être.',
    displayOrder: 3,
    minimumAge: 18,
  },
  {
    slug: 'couture',
    name: 'Couture',
    categorySlug: 'beaute-bien-etre',
    shortDescription: 'Retouches et confection.',
    displayOrder: 4,
    minimumAge: 16,
  },
  // Famille & Accompagnement
  {
    slug: 'garde-enfants',
    name: 'Garde d’enfants',
    categorySlug: 'famille-accompagnement',
    shortDescription: 'Garde et accompagnement d’enfants.',
    displayOrder: 1,
    minimumAge: 16,
  },
  {
    slug: 'professeur-domicile',
    name: 'Professeur à domicile',
    categorySlug: 'famille-accompagnement',
    shortDescription: 'Soutien scolaire à domicile.',
    displayOrder: 2,
    minimumAge: 16,
  },
  {
    slug: 'veterinaire',
    name: 'Vétérinaire',
    categorySlug: 'famille-accompagnement',
    shortDescription: 'Soins et conseils animaliers.',
    displayOrder: 3,
    minimumAge: 16,
  },
  // Accueil, Surveillance & Commerce
  {
    slug: 'caissier-caissiere',
    name: 'Caissier/Caissière',
    categorySlug: 'accueil-surveillance-commerce',
    shortDescription: 'Encaissement et accueil commerce.',
    displayOrder: 1,
    minimumAge: 16,
  },
  {
    slug: 'agent-accueil',
    name: 'Agent d’accueil',
    categorySlug: 'accueil-surveillance-commerce',
    shortDescription: 'Accueil et orientation.',
    displayOrder: 2,
    minimumAge: 16,
  },
  {
    slug: 'gardien',
    name: 'Gardien',
    categorySlug: 'accueil-surveillance-commerce',
    shortDescription: 'Gardiennage de sites.',
    displayOrder: 3,
    minimumAge: 18,
  },
  {
    slug: 'agent-securite',
    name: 'Agent de sécurité',
    categorySlug: 'accueil-surveillance-commerce',
    shortDescription: 'Surveillance et sécurité.',
    displayOrder: 4,
    minimumAge: 18,
  },
  // Auto & Dépannage
  {
    slug: 'lavage-auto',
    name: 'Lavage auto',
    categorySlug: 'auto-depannage',
    shortDescription: 'Lavage et entretien véhicule.',
    displayOrder: 1,
    minimumAge: 16,
  },
  {
    slug: 'mecanique-automobile',
    name: 'Mécanique automobile',
    categorySlug: 'auto-depannage',
    shortDescription: 'Réparations mécaniques.',
    displayOrder: 2,
    minimumAge: 16,
  },
  {
    slug: 'depannage-automobile',
    name: 'Dépannage automobile',
    categorySlug: 'auto-depannage',
    shortDescription: 'Assistance et dépannage.',
    displayOrder: 3,
    minimumAge: 18,
  },
  {
    slug: 'vulcanisation-pneus',
    name: 'Vulcanisation & Pneus',
    categorySlug: 'auto-depannage',
    shortDescription: 'Pneus et vulcanisation.',
    displayOrder: 4,
    minimumAge: 16,
  },
];

export const DOCUMENT_TYPE_SEEDS = [
  {
    code: 'IDENTITY_DOCUMENT',
    name: 'Pièce d’identité',
    description: 'Carte d’identité, passeport ou document officiel équivalent.',
  },
  {
    code: 'CIP',
    name: 'CIP',
    description: 'Carte d’identité personnelle (Bénin).',
  },
  {
    code: 'PASSPORT',
    name: 'Passeport',
    description: 'Passeport en cours de validité.',
  },
  {
    code: 'RESIDENCE_CERTIFICATE',
    name: 'Certificat de résidence',
    description: 'Justificatif de domicile / certificat de résidence.',
  },
  {
    code: 'LIVE_SELFIE',
    name: 'Selfie live',
    description: 'Selfie capturé en direct depuis l’application pour vérification humaine.',
  },
  {
    code: 'PROFILE_PHOTO',
    name: 'Photo de profil',
    description:
      'Photo de profil publique du Jobber (distincte du selfie KYC). Permet de le reconnaître.',
  },
  {
    code: 'CV',
    name: 'CV',
    description: 'Curriculum vitae (facultatif sauf exigence service).',
  },
  {
    code: 'DRIVING_LICENSE',
    name: 'Permis de conduire',
    description: 'Permis de conduire valide le cas échéant.',
  },
  {
    code: 'DIPLOMA',
    name: 'Diplôme',
    description: 'Diplôme ou attestation de formation.',
  },
  {
    code: 'CERTIFICATE',
    name: 'Certificat',
    description: 'Certificat professionnel ou attestation.',
  },
  {
    code: 'CERTIFICATION',
    name: 'Certification',
    description: 'Certification métier (alias produit de CERTIFICATE).',
  },
  {
    code: 'AUTHORIZATION',
    name: 'Autorisation',
    description: 'Autorisation administrative ou parentale.',
  },
  {
    code: 'PROFESSIONAL_PROOF',
    name: 'Justificatif professionnel',
    description: 'Justificatif d’activité ou d’expérience.',
  },
] as const;
