import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  getFavouriteSymbols,
  setFavouriteSymbols,
  toggleFavouriteSymbol,
} from "@/lib/markets/symbolCatalogue";
import { ensureUserDefaults } from "@/lib/store";

/** List the operator's pinned pairs. */
export async function GET() {
  try {
    const user = await requirePlatformAccess();
    await ensureUserDefaults(user.id);
    const favourites = await getFavouriteSymbols(user.id);
    return NextResponse.json({ favourites });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * Replace or toggle favourites.
 * - Body `{ symbols: string[] }` replaces the whole list.
 * - Body `{ toggle: string }` pins/unpins one symbol from the card star.
 */
export async function PUT(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    await ensureUserDefaults(user.id);
    const body = (await req.json().catch(() => ({}))) as {
      symbols?: unknown;
      toggle?: unknown;
    };

    if (typeof body.toggle === "string" && body.toggle.trim()) {
      const result = await toggleFavouriteSymbol(user.id, body.toggle);
      return NextResponse.json(result);
    }

    if (Array.isArray(body.symbols)) {
      const favourites = await setFavouriteSymbols(
        user.id,
        body.symbols.filter((s): s is string => typeof s === "string"),
      );
      return NextResponse.json({ favourites });
    }

    return NextResponse.json(
      { error: "Provide symbols[] or toggle." },
      { status: 400 },
    );
  } catch (e) {
    return handleError(e);
  }
}
