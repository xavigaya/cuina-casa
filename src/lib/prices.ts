import { supabaseBrowser } from "./supabase/client";
import { priceKey } from "./shopping-plus";

/** Desa (o actualitza) el preu aproximat d'un producte. Torna un missatge d'error o null. */
export async function savePrice(
  householdId: string,
  input: { name: string; price: number; quantity: number; unit: string | null },
): Promise<string | null> {
  const key = priceKey(input.name);
  if (!key) return "Cal un nom";
  const { error } = await supabaseBrowser()
    .from("product_prices")
    .upsert(
      { household_id: householdId, name: input.name.trim(), key, price: input.price, quantity: input.quantity > 0 ? input.quantity : 1, unit: input.unit || null },
      { onConflict: "household_id,key" },
    );
  if (!error) return null;
  return /relation|schema cache|does not exist/i.test(error.message) ? "Cal executar la migració 0007 a Supabase per desar preus" : error.message;
}
