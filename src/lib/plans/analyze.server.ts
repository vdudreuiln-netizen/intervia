import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { PLAN_SYSTEM_PROMPT, PlanAnalysisSchema, type PlanAnalysis } from "./analysis";

/**
 * Lecture d'un plan (image JPEG/PNG) par Claude. Clé : ANTHROPIC_API_KEY (Vercel).
 * Modèle réglable par ANTHROPIC_PLAN_MODEL (défaut : claude-opus-5-5).
 */
export const PLAN_MODEL = process.env.ANTHROPIC_PLAN_MODEL?.trim() || "claude-opus-5-5";

export class PlanAnalysisError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
  ) {
    super(message);
  }
}

export const planAnalysisEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export async function analyzePlanImage(image: Uint8Array, mediaType: "image/jpeg" | "image/png", hint: { levelLabel: string | null }): Promise<PlanAnalysis> {
  if (!planAnalysisEnabled()) throw new PlanAnalysisError("ANTHROPIC_API_KEY manquante", "La lecture automatique des plans n'est pas activée sur ce compte : dessinez les pièces à la main.");
  const client = new Anthropic({ maxRetries: 2, timeout: 240_000 });
  let message: Anthropic.Beta.Messages.BetaMessage;
  try {
    message = await client.beta.messages
      .stream({
        model: PLAN_MODEL,
        max_tokens: 32000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "high", format: betaZodOutputFormat(PlanAnalysisSchema) },
        system: [{ type: "text", text: PLAN_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: Buffer.from(image).toString("base64") } },
              { type: "text", text: `Lis ce plan de logement.${hint.levelLabel ? ` Niveau indiqué par l'artisan : ${hint.levelLabel}.` : ""}` },
            ],
          },
        ],
      })
      .finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new PlanAnalysisError(e.message, "Le service de lecture est très sollicité. Réessayez dans une minute.");
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new PlanAnalysisError(e.message, "La lecture des plans est mal configurée (clé API). Prévenez l'administrateur du site.");
    if (e instanceof Anthropic.BadRequestError) throw new PlanAnalysisError(e.message, "Cette image n'a pas pu être lue. Essayez une photo plus nette ou un autre fichier.");
    if (e instanceof Anthropic.APIError) throw new PlanAnalysisError(e.message, "Le service de lecture ne répond pas. Réessayez dans quelques minutes.");
    throw new PlanAnalysisError(e instanceof Error ? e.message : String(e), "Lecture impossible pour le moment. Réessayez dans quelques minutes.");
  }
  if (message.stop_reason === "refusal") throw new PlanAnalysisError("refus", "Ce document n'a pas pu être lu. Dessinez les pièces à la main.");
  if (message.stop_reason === "max_tokens") throw new PlanAnalysisError("max_tokens", "Plan trop chargé pour une seule lecture : importez un niveau à la fois.");
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PlanAnalysisError("JSON illisible", "La réponse de la lecture est illisible. Réessayez.");
  }
  const parsed = PlanAnalysisSchema.safeParse(json);
  if (!parsed.success) throw new PlanAnalysisError(parsed.error.message, "La réponse de la lecture est incomplète. Réessayez.");
  return parsed.data;
}
