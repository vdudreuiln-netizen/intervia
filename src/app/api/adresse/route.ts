import { NextResponse, type NextRequest } from "next/server";
import { geocode } from "@/lib/geo/adresse";

/** Autocomplétion d'adresse (réservée aux utilisateurs connectés, cf. middleware). */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const suggestions = await geocode(q, 5);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [], error: "Service d'adresses indisponible : saisissez l'adresse à la main." }, { status: 200 });
  }
}
