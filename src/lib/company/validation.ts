/**
 * Contrôles des identifiants d'entreprise français.
 */

/** SIRET : 14 chiffres + clé de Luhn (exception : établissements La Poste, SIREN 356000000, somme des chiffres multiple de 5). */
export function isValidSiret(input: string): boolean {
  const s = input.replace(/\s/g, "");
  if (!/^\d{14}$/.test(s)) return false;
  if (s.startsWith("356000000") && [...s].reduce((a, d) => a + Number(d), 0) % 5 === 0) return true;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(s[13 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function normalizeSiret(input: string): string {
  return input.replace(/\s/g, "");
}

/** IBAN sans espaces, en majuscules. */
export function normalizeIban(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

/** Contrôle ISO 13616 (modulo 97). Les IBAN français font 27 caractères. */
export function isValidIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith("FR") && iban.length !== 27) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of v) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** IBAN affiché par blocs de 4 : FR76 3000 6000 0112 3456 7890 189 */
export function formatIban(input: string): string {
  return normalizeIban(input).replace(/(.{4})/g, "$1 ").trim();
}

/** BIC : 8 ou 11 caractères (banque 4 lettres, pays 2 lettres, lieu 2, agence 3 facultatif). */
export function isValidBic(input: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(input.replace(/\s/g, "").toUpperCase());
}

export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.trim());
}

/** Téléphone français : 10 chiffres commençant par 0, ou +33 suivi de 9 chiffres. */
export function isValidFrenchPhone(input: string): boolean {
  const s = input.replace(/[\s.\-()]/g, "");
  return /^0[1-9]\d{8}$/.test(s) || /^\+33[1-9]\d{8}$/.test(s);
}

export function isValidPostalCode(input: string): boolean {
  return /^\d{5}$/.test(input.trim());
}
