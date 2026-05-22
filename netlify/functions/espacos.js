/**
 * API somente leitura — Espaço ocupado por cliente
 *
 * Endpoint:  GET /api/espacos
 * Auth:      Header  X-API-Key: <valor configurado em FREEZER_API_KEY no Netlify>
 *            ou Query ?apiKey=<valor>
 *
 * Parâmetros opcionais (query string):
 *   ?cliente=Acai Norte     → filtra por nome exato (case-insensitive)
 *   ?sala=Sala fria 01      → filtra por nome da sala
 *   ?freezer=FZ-01          → filtra por nome do freezer
 *
 * Resposta 200 — application/json:
 * {
 *   "geradoEm": "2026-05-20T14:30:00.000Z",
 *   "total": 3,
 *   "clientes": [
 *     {
 *       "cliente":           "Acai Norte",
 *       "sala":              "Sala fria 01",
 *       "freezer":           "FZ-01",
 *       "plano":             "1/2",
 *       "espacoContratado":  70,
 *       "espacoOcupado":     70,
 *       "unidade":           "cm"
 *     }
 *   ]
 * }
 */

const { initializeApp, getApps } = require("firebase/app");
const { getFirestore, doc, getDoc } = require("firebase/firestore");

const COLLECTION  = "sistemas";
const DOC_ID      = "gestao-freezers";

const PLANS = {
  quarter:      "1/4",
  half:         "1/2",
  threeQuarter: "3/4",
  full:         "1"
};

// ─── Initialise Firebase (reuse across warm invocations) ────────────────────

function getFirebaseApp() {
  if (getApps().length) return getApps()[0];

  const config = {
    apiKey:            process.env.FIREBASE_API_KEY,
    authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
    projectId:         process.env.FIREBASE_PROJECT_ID,
    storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId:             process.env.FIREBASE_APP_ID
  };

  if (!config.apiKey || !config.projectId) {
    throw new Error("Firebase não configurado. Defina as variáveis de ambiente no Netlify.");
  }

  return initializeApp(config);
}

// ─── CORS headers ────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key"
};

function json(statusCode, body, extra = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
    body: JSON.stringify(body, null, 2)
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

exports.handler = async function (event) {

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // Only GET
  if (event.httpMethod !== "GET") {
    return json(405, { erro: "Método não permitido. Use GET." });
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
  const expectedKey = process.env.FREEZER_API_KEY;

  if (!expectedKey) {
    // If no key is configured, the API is disabled for safety
    return json(503, {
      erro: "API desativada. Configure a variável FREEZER_API_KEY no Netlify para habilitar."
    });
  }

  const providedKey =
    event.headers["x-api-key"] ||
    event.headers["X-API-Key"] ||
    (event.queryStringParameters || {}).apiKey;

  if (!providedKey || providedKey !== expectedKey) {
    return json(401, {
      erro: "Não autorizado. Envie um X-API-Key válido no header ou ?apiKey= na query."
    });
  }

  // ── Fetch data from Firestore ───────────────────────────────────────────────
  let data;
  try {
    const app      = getFirebaseApp();
    const db       = getFirestore(app);
    const ref      = doc(db, COLLECTION, DOC_ID);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) {
      return json(404, { erro: "Documento não encontrado no Firestore." });
    }

    data = snapshot.data();
  } catch (err) {
    console.error("Firestore error:", err);
    return json(500, { erro: "Erro ao consultar o banco de dados.", detalhe: err.message });
  }

  const rooms     = Array.isArray(data.rooms)     ? data.rooms     : [];
  const freezers  = Array.isArray(data.freezers)  ? data.freezers  : [];
  const contracts = Array.isArray(data.contracts) ? data.contracts : [];
  const afericoes = Array.isArray(data.afericoes) ? data.afericoes : [];

  // Last aferição items indexed by contractId for real usage
  const lastAfericao = afericoes.length ? afericoes[afericoes.length - 1] : null;
  const realUsageMap = {};
  if (lastAfericao?.items) {
    lastAfericao.items.forEach(item => {
      realUsageMap[item.contractId] = {
        espacoReal:       item.realCm,
        dataAfericao:     lastAfericao.date,
        statusUso:        item.deviationType === "above" ? "acima_do_contrato"
                        : item.deviationType === "below" ? "abaixo_do_contrato"
                        : "conforme"
      };
    });
  }

  // Build lookup maps
  const freezerMap = {};
  freezers.forEach(f => { freezerMap[f.id] = f; });

  const roomMap = {};
  rooms.forEach(r => { roomMap[r.id] = r; });

  // ── Build response items ─────────────────────────────────────────────────────
  const params = event.queryStringParameters || {};
  const filterCliente = params.cliente?.toLowerCase().trim();
  const filterSala    = params.sala?.toLowerCase().trim();
  const filterFreezer = params.freezer?.toLowerCase().trim();

  let clientes = contracts
    .filter(c => c.status === "active")
    .map(c => {
      const freezer = freezerMap[c.freezerId] || {};
      const room    = roomMap[freezer.roomId] || {};
      const aferido = realUsageMap[c.id] || null;

      return {
        cliente:          c.clientName,
        sala:             room.name    || "Sem sala",
        freezer:          freezer.name || "Sem freezer",
        plano:            PLANS[c.planKey] || c.planKey,
        espacoContratado: c.occupiedCm,
        espacoOcupado:    aferido ? aferido.espacoReal : c.occupiedCm,
        unidade:          "cm",
        ...(aferido && {
          ultimaAfericao: aferido.dataAfericao,
          statusUso:      aferido.statusUso
        }),
        ...(!aferido && {
          observacao: "Sem aferição registrada — valor reflete o contrato"
        })
      };
    });

  // Apply filters
  if (filterCliente) clientes = clientes.filter(c => c.cliente.toLowerCase().includes(filterCliente));
  if (filterSala)    clientes = clientes.filter(c => c.sala.toLowerCase().includes(filterSala));
  if (filterFreezer) clientes = clientes.filter(c => c.freezer.toLowerCase().includes(filterFreezer));

  return json(200, {
    geradoEm:  new Date().toISOString(),
    total:     clientes.length,
    ...(lastAfericao && { ultimaAfericao: lastAfericao.date }),
    clientes
  });
};
