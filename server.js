const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT) || 4174;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data.json");

const defaultData = {
  rooms: [],
  freezers: [],
  contracts: []
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === "/api/health") {
      return sendJson(response, { ok: true });
    }

    if (request.url === "/api/data" && request.method === "GET") {
      return sendJson(response, await readData());
    }

    if (request.url === "/api/data" && (request.method === "POST" || request.method === "PUT")) {
      const body = await readBody(request);
      const data = sanitizeData(JSON.parse(body || "{}"));
      await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
      return sendJson(response, data);
    }

    return serveStatic(request, response);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Erro interno do servidor." }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Gestao de freezers rodando em http://localhost:${PORT}`);
});

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(ROOT, requestedPath));

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Acesso negado.");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    response.end(content);
  } catch (error) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Arquivo nao encontrado.");
  }
}

async function readData() {
  try {
    const content = await fs.readFile(DATA_FILE, "utf-8");
    return sanitizeData(JSON.parse(content));
  } catch (error) {
    await fs.writeFile(DATA_FILE, JSON.stringify(defaultData, null, 2), "utf-8");
    return { ...defaultData };
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error("Payload muito grande."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, payload) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sanitizeData(data) {
  return {
    rooms: Array.isArray(data.rooms) ? data.rooms : [],
    freezers: Array.isArray(data.freezers) ? data.freezers : [],
    contracts: Array.isArray(data.contracts) ? data.contracts : []
  };
}
