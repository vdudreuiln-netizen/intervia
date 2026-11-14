/**
 * Informations sur l'ÉDITEUR de ClimDevis (vous), affichées dans les pages légales.
 * ➜ À COMPLÉTER avant la mise en ligne : remplacez chaque valeur « [À COMPLÉTER …] ».
 *   (Sur GitHub : ouvrez ce fichier, cliquez sur le crayon « Edit this file », modifiez,
 *   puis « Commit changes ». Vercel redéploie automatiquement.)
 */
export const EDITOR = {
  productName: "ClimDevis",
  companyName: "[À COMPLÉTER : raison sociale ou nom et prénom + « EI »]",
  legalForm: "[À COMPLÉTER : forme juridique, ex. Entreprise individuelle, SAS au capital de … €]",
  siren: "[À COMPLÉTER : SIREN]",
  rcsOrRm: "[À COMPLÉTER : RCS de … ou « dispensé d'immatriculation »]",
  address: "[À COMPLÉTER : adresse postale complète]",
  email: "[À COMPLÉTER : adresse e-mail de contact]",
  phone: "[À COMPLÉTER : numéro de téléphone]",
  publicationDirector: "[À COMPLÉTER : nom du directeur de la publication]",
  /** Tant que l'éditeur est en franchise de TVA. */
  vatMention: "TVA non applicable, art. 293 B du CGI",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "[À COMPLÉTER : e-mail du support]",
  dpoContact: "[À COMPLÉTER : e-mail pour les questions de données personnelles]",
  /** Ville du tribunal compétent (litiges entre professionnels). */
  court: "[À COMPLÉTER : ville du tribunal de commerce]",
};

/** Version des documents contractuels : à changer à chaque modification des CGV / politique. */
export const LEGAL_VERSION = "2026-11-14";

export const HOSTING = {
  app: "Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis (vercel.com) — fonctions exécutées dans la région Paris (cdg1)",
  database: "Supabase Inc., 970 Toa Payoh North #07-04, Singapour 318992 (supabase.com) — base de données hébergée dans la région Union européenne choisie à la création du projet (Paris, eu-west-3)",
  payments: "Stripe Payments Europe Limited, 1 Grand Canal Street Lower, Dublin 2, Irlande (stripe.com)",
};
