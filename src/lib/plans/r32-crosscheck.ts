/**
 * Recoupement du calcul de surface minimale R32 avec les tableaux publiés dans
 * les notices d'installation des fabricants. Règle : le résultat ClimDevis doit
 * être ÉGAL OU PLUS PRUDENT (surface plus grande) que la notice.
 * Affiché dans Paramètres › Règles d'implantation et vérifié par les tests.
 */
import { minRoomArea } from "./rules";

export interface CrossCheckCase {
  brand: string;
  document: string;
  chargeKg: number;
  heightM: number;
  position: string;
  noticeM2: number;
}

export const R32_CROSSCHECK_CASES: CrossCheckCase[] = [
  { brand: "Mitsubishi Electric", document: "Notice d'installation MXZ-6F120VGD (VG79Y171H01)", chargeKg: 2.0, heightM: 1.8, position: "murale", noticeM2: 6 },
  { brand: "Mitsubishi Electric", document: "Notice d'installation MXZ-6F120VGD (VG79Y171H01)", chargeKg: 5.0, heightM: 1.8, position: "murale", noticeM2: 24 },
  { brand: "Mitsubishi Electric", document: "Notice d'installation MXZ-6F120VGD (VG79Y171H01)", chargeKg: 7.0, heightM: 1.8, position: "murale", noticeM2: 47 },
  { brand: "Daikin", document: "Guide de référence installateur 2MXM40A / 2MXM50A (4PEN766272-4C)", chargeKg: 2.4, heightM: 2.2, position: "plafond", noticeM2: 4.74 },
];

export interface CrossCheckResult extends CrossCheckCase {
  climdevisM2: number | null;
  ok: boolean;
}

export function runR32CrossCheck(cases = R32_CROSSCHECK_CASES): CrossCheckResult[] {
  return cases.map((c) => {
    const climdevisM2 = minRoomArea(c.chargeKg, "R32", c.heightM);
    return { ...c, climdevisM2, ok: climdevisM2 !== null && climdevisM2 >= c.noticeM2 };
  });
}
