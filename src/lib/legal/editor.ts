/**
 * Informations sur l'ÉDITEUR de ClimDevis (vous), affichées dans les pages légales.
 * ➜ À METTRE À JOUR avant le premier client payant (statut définitif).
 *   (Sur GitHub : ouvrez ce fichier, cliquez sur le crayon « Edit this file », modifiez,
 *   puis « Commit changes ». Vercel redéploie automatiquement.)
 */
// À METTRE À JOUR avant le premier client payant (statut définitif).
// Informations provisoires : phase de test, aucun client payant.
export const EDITOR = {
  productName: "ClimDevis",
  companyName: "Vincent Dudreuil EI",
  legalForm: "Entrepreneur individuel",
  siren: "851 974 907",
  siret: "851 974 907 00012",
  /** Immatriculation (RCS / RM / RNE) : vide = non affichée, le SIRET suffit pendant la phase de test. */
  rcsOrRm: "",
  address: "10 rue Capella, 33185 Le Haillan",
  email: "monartisanplombier33@gmail.com",
  /** Vide = non affiché. */
  phone: "",
  publicationDirector: "Vincent Dudreuil",
  /** Tant que l'éditeur est en franchise de TVA. */
  vatMention: "TVA non applicable, art. 293 B du CGI",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "monartisanplombier33@gmail.com",
  dpoContact: "monartisanplombier33@gmail.com",
  /** Ville du tribunal compétent (litiges entre professionnels) : celui du siège (Le Haillan, Gironde). */
  court: "Bordeaux",
};

/** Version des documents contractuels : à changer à chaque modification des CGV / politique. */
export const LEGAL_VERSION = "2026-11-15";

export const HOSTING = {
  app: "Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis (vercel.com) — fonctions exécutées dans la région Paris (cdg1)",
  database: "Supabase Inc., 970 Toa Payoh North #07-04, Singapour 318992 (supabase.com) — base de données hébergée dans la région Union européenne choisie à la création du projet (Paris, eu-west-3)",
  payments: "Stripe Payments Europe Limited, 1 Grand Canal Street Lower, Dublin 2, Irlande (stripe.com)",
  /** Lecture des tarifs fournisseurs PDF (fonction facultative). Entité contractante pour l'EEE selon les conditions commerciales d'Anthropic. */
  ai: "Anthropic Ireland, Limited (anthropic.com), Irlande — modèles Claude, avec possible traitement hors de l'Union européenne encadré par les clauses contractuelles types",
};
