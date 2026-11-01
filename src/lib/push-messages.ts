/**
 * Text dels avisos al mòbil. El compon el servidor a partir del tipus d'avís,
 * perquè ningú no pugui enviar missatges arbitraris a la resta de la família.
 */

export type PushKind = "llista" | "propostes" | "respostes";

export type PushEvent =
  | { type: "llista"; items: string[] }
  | { type: "proposta"; what: "recepta" | "menu"; label: string; count?: number }
  | { type: "resposta"; what: "recepta" | "menu"; approved: boolean; label: string; to: string; count?: number };

export interface PushMessage {
  kind: PushKind;
  title: string;
  body: string;
  url: string;
  tag: string;
  /** destinatari concret (respostes); si no, la família */
  to?: string;
}

const clean = (s: unknown, max = 60) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Valida el cos d'una petició a /api/notify */
export function parsePushEvent(raw: unknown): PushEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const what = r.what === "menu" ? "menu" : "recepta";
  const count = Number.isFinite(Number(r.count)) && Number(r.count) > 1 ? Math.min(99, Math.floor(Number(r.count))) : undefined;
  if (r.type === "llista") {
    const items = Array.isArray(r.items) ? r.items.map((i) => clean(i, 40)).filter(Boolean).slice(0, 50) : [];
    return items.length ? { type: "llista", items } : null;
  }
  if (r.type === "proposta") {
    const label = clean(r.label);
    return label ? { type: "proposta", what, label, count } : null;
  }
  if (r.type === "resposta") {
    const label = clean(r.label);
    const to = clean(r.to, 40);
    return label && /^[0-9a-f-]{36}$/i.test(to) ? { type: "resposta", what, approved: r.approved === true, label, to, count } : null;
  }
  return null;
}

function list(items: string[], max = 4): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const text = shown.length > 1 ? `${shown.slice(0, -1).join(", ")} i ${shown.at(-1)}` : shown[0];
  return rest > 0 ? `${shown.join(", ")} i ${rest} més` : text;
}

export function buildPushMessage(event: PushEvent, sender: string): PushMessage {
  const who = clean(sender, 40) || "Algú de casa";
  switch (event.type) {
    case "llista":
      return {
        kind: "llista",
        title: "Llista de la compra",
        body: `${who} hi ha afegit ${list(event.items)}`,
        url: "/llista",
        tag: "llista",
      };
    case "proposta": {
      const n = event.count && event.count > 1 ? event.count : 0;
      const body =
        event.what === "recepta"
          ? `${who} proposa la recepta «${event.label}»`
          : n
            ? `${who} proposa ${n} plats per al menú`
            : `${who} proposa «${event.label}» per al menú`;
      return { kind: "propostes", title: "Proposta per revisar", body, url: event.what === "recepta" ? "/receptes" : "/menu", tag: `proposta-${event.what}` };
    }
    case "resposta": {
      const verb = event.approved ? "ha aprovat" : "no ha acceptat";
      const n = event.count && event.count > 1 ? event.count : 0;
      const body = n ? `${who} ${verb} ${n} propostes teves del menú` : `${who} ${verb} la teva proposta «${event.label}»`;
      return {
        kind: "respostes",
        title: event.approved ? "Proposta aprovada 👍" : "Proposta no acceptada",
        body,
        url: event.what === "recepta" ? "/receptes" : "/menu",
        tag: `resposta-${event.what}`,
        to: event.to,
      };
    }
  }
}
