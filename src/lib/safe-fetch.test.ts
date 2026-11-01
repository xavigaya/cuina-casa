import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { SafeFetchError, checkUrl, isPrivateAddress, safeFetch } from "./safe-fetch";

describe("adreces internes", () => {
  it("reconeix les adreces privades, locals i reservades", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.10", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "151.101.1.69", "2a00:1450:4003:80e::200e"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("rebutja enllaços perillosos abans de connectar", () => {
    const bad = [
      "ftp://exemple.cat/x",
      "file:///etc/passwd",
      "http://localhost/",
      "http://127.0.0.1/",
      "http://[::1]/",
      "http://2130706433/", // 127.0.0.1 escrit com un número
      "http://0x7f.0.0.1/",
      "http://exemple.cat:22/",
      "http://usuari:clau@exemple.cat/",
      "http://router.local/",
      "http://169.254.169.254/latest/meta-data/",
    ];
    for (const u of bad) expect(() => checkUrl(u), u).toThrow(SafeFetchError);
    expect(checkUrl("https://www.ccma.cat/cuines/").hostname).toBe("www.ccma.cat");
  });
});

describe("descàrregues", () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/gran") {
        res.writeHead(200, { "content-type": "application/octet-stream" }); // sense content-length
        const chunk = Buffer.alloc(64 * 1024, 1);
        let sent = 0;
        const timer = setInterval(() => {
          if (sent >= 4 * 1024 * 1024) {
            clearInterval(timer);
            res.end();
            return;
          }
          res.write(chunk);
          sent += chunk.length;
        }, 1);
        req.on("close", () => clearInterval(timer));
        return;
      }
      if (req.url === "/cap-a-intern") {
        res.writeHead(302, { location: `http://localhost:${(server.address() as AddressInfo).port}/secret` });
        return res.end();
      }
      if (req.url === "/cap-a-ftp") {
        res.writeHead(302, { location: "ftp://exemple.cat/" });
        return res.end();
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hola");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("no connecta a la xarxa interna", async () => {
    await expect(safeFetch(`${base}/`)).rejects.toMatchObject({ reason: "adreça" });
  });

  it("descarrega quan l'adreça està permesa (proves)", async () => {
    const res = await safeFetch(`${base}/`, { allowHosts: ["127.0.0.1"] });
    expect(res.text()).toBe("hola");
  });

  it("no segueix redireccions cap a la xarxa interna ni a altres protocols", async () => {
    await expect(safeFetch(`${base}/cap-a-intern`, { allowHosts: ["127.0.0.1"] })).rejects.toMatchObject({ reason: "adreça" });
    await expect(safeFetch(`${base}/cap-a-ftp`, { allowHosts: ["127.0.0.1"] })).rejects.toMatchObject({ reason: "adreça" });
  });

  it("talla la descàrrega en passar de la mida màxima", async () => {
    await expect(safeFetch(`${base}/gran`, { allowHosts: ["127.0.0.1"], maxBytes: 1024 * 1024 })).rejects.toMatchObject({ reason: "mida" });
  });
});

describe("enllaços de les receptes", async () => {
  const { httpUrlOrNull } = await import("./recipes");
  it("només desa enllaços http(s)", () => {
    expect(httpUrlOrNull("javascript:alert(1)")).toBeNull();
    expect(httpUrlOrNull("data:text/html,hola")).toBeNull();
    expect(httpUrlOrNull("una recepta de l'àvia")).toBeNull();
    expect(httpUrlOrNull("  ")).toBeNull();
    expect(httpUrlOrNull("www.ccma.cat/cuines/x")).toBe("https://www.ccma.cat/cuines/x");
    expect(httpUrlOrNull("https://cookpad.com/es/recetas/1")).toBe("https://cookpad.com/es/recetas/1");
  });
});
