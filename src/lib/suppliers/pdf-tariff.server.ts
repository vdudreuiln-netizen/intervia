import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { EXTRACTION_SYSTEM_PROMPT, ExtractionSchema, type ExtractedRow } from "./pdf-tariff";

/**
 * Extraction des lignes de tarif d'un lot de pages PDF par Claude.
 * Clé : variable d'environnement ANTHROPIC_API_KEY (Vercel), jamais dans le code.
 * Modèle réglable par ANTHROPIC_TARIFF_MODEL (défaut : claude-opus-5-5).
 */
export const TARIFF_MODEL = process.env.ANTHROPIC_TARIFF_MODEL?.trim() || "claude-opus-5-5";

export class ExtractionError extends Error {
  constructor(
    message: string,
    /** Message en français pour l'artisan. */
    public readonly userMessage: string,
    /** Le quota doit-il être rendu ? (échec technique, pas de résultat facturé utile) */
    public readonly refund = true,
  ) {
    super(message);
  }
}

export function pdfImportEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function extractTariffRows(pdf: Uint8Array): Promise<ExtractedRow[]> {
  if (!pdfImportEnabled()) {
    throw new ExtractionError("ANTHROPIC_API_KEY manquante", "L'import de tarif PDF n'est pas encore activé sur ce compte. Importez le tarif Excel / CSV du fournisseur.");
  }
  const client = new Anthropic({ maxRetries: 2, timeout: 270_000 });
  const data = Buffer.from(pdf).toString("base64");

  let message: Anthropic.Beta.Messages.BetaMessage;
  try {
    const stream = client.beta.messages.stream({
      model: TARIFF_MODEL,
      max_tokens: 64000,
      // Si le modèle décline (faux positif de sécurité), l'API réessaie sur le modèle de repli par défaut.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: betaZodOutputFormat(ExtractionSchema),
      },
      system: [
        {
          type: "text",
          text: EXTRACTION_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data },
            },
            {
              type: "text",
              text: "Extrais toutes les lignes de tarif de ces pages.",
            },
          ],
        },
      ],
    });
    message = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new ExtractionError(e.message, "Le service d'analyse est très sollicité. Réessayez dans une minute.");
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new ExtractionError(e.message, "L'import de tarif PDF est mal configuré (clé API). Prévenez l'administrateur du site.");
    if (e instanceof Anthropic.BadRequestError) throw new ExtractionError(e.message, "Ce PDF n'a pas pu être lu (protégé, abîmé ou trop lourd). Essayez avec moins de pages.");
    if (e instanceof Anthropic.APIError) throw new ExtractionError(e.message, "Le service d'analyse ne répond pas. Réessayez dans quelques minutes.");
    throw new ExtractionError(e instanceof Error ? e.message : String(e), "Analyse impossible pour le moment. Réessayez dans quelques minutes.");
  }

  if (message.stop_reason === "refusal") {
    throw new ExtractionError(`refus ${message.stop_details?.category ?? ""}`, "Ces pages n'ont pas pu être analysées. Essayez d'autres pages ou importez le tarif Excel / CSV.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new ExtractionError("max_tokens", "Trop de lignes sur ces pages pour une seule analyse : choisissez moins de pages.");
  }
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ExtractionError("JSON illisible", "La réponse de l'analyse est illisible. Réessayez.");
  }
  const parsed = ExtractionSchema.safeParse(json);
  if (!parsed.success) throw new ExtractionError(parsed.error.message, "La réponse de l'analyse est incomplète. Réessayez.");
  return parsed.data.rows;
}
