/**
 * Descàrregues des del servidor d'adreces que escriu l'usuari (importar una
 * recepta, una foto d'un enllaç…) sense que es puguin fer servir per arribar a
 * la xarxa interna (SSRF):
 *  - només http(s) i els ports web habituals;
 *  - es comprova la IP real a cada connexió (també després de resoldre el nom
 *    i a cada redirecció), així no serveixen els noms que apunten a 127.0.0.1;
 *  - es talla la descàrrega quan supera la mida màxima.
 * Només per al servidor.
 */
import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(addr, prefix, "ipv6");
}

/** És una adreça de xarxa interna, local o reservada? */
export function isPrivateAddress(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, "");
  if (net.isIPv4(clean)) return blocked.check(clean, "ipv4");
  if (net.isIPv6(clean)) {
    // IPv4 dins d'IPv6 (::ffff:127.0.0.1 o ::ffff:7f00:1): no les fa servir cap web normal
    if (/^(0{0,4}:){0,5}:?ffff:/i.test(clean) || clean.toLowerCase().startsWith("::ffff:")) return true;
    return blocked.check(clean, "ipv6");
  }
  return true; // no és una IP vàlida
}

export class SafeFetchError extends Error {
  constructor(
    message: string,
    public reason: "adreça" | "mida" | "xarxa" | "redireccions",
  ) {
    super(message);
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

function makeLookup(allowHosts: Set<string>) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = addresses as dns.LookupAddress[];
      if (!list.length || (!allowHosts.has(hostname) && list.some((a) => isPrivateAddress(a.address)))) {
        const e = new Error(`Adreça no permesa: ${hostname}`) as NodeJS.ErrnoException;
        e.code = "EBLOCKED";
        return callback(e);
      }
      if (options.all) callback(null, list);
      else callback(null, list[0].address, list[0].family);
    });
  };
}

/** Comprova una adreça abans de connectar-s'hi (protocol, port i IP escrita directament). */
export function checkUrl(raw: string | URL, allowHosts: Set<string> = new Set()): URL {
  let url: URL;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new SafeFetchError("L'enllaç no és vàlid", "adreça");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new SafeFetchError("Només es poden obrir enllaços http o https", "adreça");
  if (url.port && !["80", "443"].includes(url.port) && !allowHosts.has(url.hostname)) {
    throw new SafeFetchError("L'enllaç fa servir un port no permès", "adreça");
  }
  if (url.username || url.password) throw new SafeFetchError("L'enllaç no és vàlid", "adreça");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowHosts.has(url.hostname)) {
    if (net.isIP(host) && isPrivateAddress(host)) throw new SafeFetchError("Aquest enllaç apunta a una xarxa interna", "adreça");
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan)$/i.test(host)) throw new SafeFetchError("Aquest enllaç apunta a una xarxa interna", "adreça");
  }
  return url;
}

export interface SafeResponse {
  ok: boolean;
  status: number;
  url: string;
  headers: Headers;
  body: Buffer;
  text: () => string;
}

const agents = new Map<string, Agent>();
function agentFor(allowHosts: Set<string>): Agent {
  const key = [...allowHosts].sort().join(",");
  let agent = agents.get(key);
  if (!agent) {
    agent = new Agent({ connect: { lookup: makeLookup(allowHosts) as never }, connectTimeout: 8000 });
    agents.set(key, agent);
  }
  return agent;
}

export async function safeFetch(
  raw: string | URL,
  options: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
    /** només per a les proves: noms que es poden obrir encara que siguin locals */
    allowHosts?: string[];
  } = {},
): Promise<SafeResponse> {
  const allow = new Set(options.allowHosts ?? []);
  const maxBytes = options.maxBytes ?? 5_000_000;
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 12_000);
  let url = checkUrl(raw, allow);

  for (let hop = 0; hop <= (options.maxRedirects ?? 5); hop++) {
    let res;
    try {
      res = await undiciFetch(url, { headers: options.headers, redirect: "manual", signal: deadline, dispatcher: agentFor(allow) });
    } catch (e) {
      const cause = (e as { cause?: { code?: string } }).cause;
      if (cause?.code === "EBLOCKED") throw new SafeFetchError("Aquest enllaç apunta a una xarxa interna", "adreça");
      throw new SafeFetchError("No s'ha pogut obrir l'enllaç", "xarxa");
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!location) throw new SafeFetchError("Redirecció sense destinació", "redireccions");
      url = checkUrl(new URL(location, url), allow);
      continue;
    }

    // Lectura amb límit: es talla tan bon punt passa de la mida màxima
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new SafeFetchError("El fitxer és massa gran", "mida");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new SafeFetchError("El fitxer és massa gran", "mida");
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks);
    return {
      ok: res.ok,
      status: res.status,
      url: url.toString(),
      headers: res.headers as unknown as Headers,
      body,
      text: () => new TextDecoder("utf-8").decode(body),
    };
  }
  throw new SafeFetchError("Massa redireccions", "redireccions");
}
