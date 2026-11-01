#!/usr/bin/env python3
"""Genera l'SQL de càrrega d'aliments a partir de supabase/data/aliments.tsv.

Ús:  python3 scripts/generar-aliments.py > /tmp/aliments.sql
La migració 0003 ja inclou el resultat; torna'l a generar si edites el TSV.
"""
import pathlib
import sys

GROUPS = {
    "verdura", "fruita", "patata", "cereal_integral", "cereal_refinat", "llegum", "peix", "ou",
    "aviram", "carn_vermella", "carn_processada", "fruits_secs", "lactic", "oli", "greix",
    "sucre", "condiment", "beguda",
}

def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"

def num(s: str) -> str:
    s = s.strip()
    return s if s else "null"

def main() -> None:
    path = pathlib.Path(__file__).resolve().parent.parent / "supabase" / "data" / "aliments.tsv"
    rows = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) != 12:
            sys.exit(f"Línia {n}: calen 12 columnes, n'hi ha {len(cols)}")
        name, aliases, kcal, carbs, prot, fat, fiber, group, unit_g, pack_g, density, plate = cols
        if group not in GROUPS:
            sys.exit(f"Línia {n}: grup desconegut «{group}»")
        alias_list = [a.strip() for a in aliases.split(";") if a.strip()]
        alias_sql = "array[" + ", ".join(q(a) for a in alias_list) + "]::text[]" if alias_list else "'{}'::text[]"
        rows.append(
            f"  ({q(name)}, {alias_sql}, {num(kcal)}, {num(carbs)}, {num(prot)}, {num(fat)}, {num(fiber)}, "
            f"{q(group)}, {num(unit_g)}, {num(pack_g)}, {num(density) if density.strip() else '1'}, "
            f"{num(plate) if plate.strip() else '1'})"
        )
    print("insert into public.foods (name, aliases, kcal, carbs, protein, fat, fiber, harvard_group, unit_g, pack_g, density, plate_factor) values")
    print(",\n".join(rows))
    print("on conflict (name) where household_id is null do update set")
    print("  aliases = excluded.aliases, kcal = excluded.kcal, carbs = excluded.carbs, protein = excluded.protein,")
    print("  fat = excluded.fat, fiber = excluded.fiber, harvard_group = excluded.harvard_group, unit_g = excluded.unit_g,")
    print("  pack_g = excluded.pack_g, density = excluded.density, plate_factor = excluded.plate_factor;")
    print(f"-- {len(rows)} aliments", file=sys.stderr)

if __name__ == "__main__":
    main()
