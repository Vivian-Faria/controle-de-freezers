const admin = require("firebase-admin");

const COLLECTION = "sistemas";
const DOC_ID     = "gestao-freezers";

const PLANS = {
  quarter:      "1/4",
  half:         "1/2",
  threeQuarter: "3/4",
  full:         "1"
};

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key"
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
    body: JSON.stringify(body, null, 2)
  };
}

function initAdmin() {
  if (admin.apps.length) return admin.app();

  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
    .replace(/\\n/g, "\n")   // caso o Netlify escape as quebras de linha
    .replace(/^"|"$/g, "");  // remove aspas extras se existirem

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey
    })
  });
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return json(405, { erro: "Use GET." });

  const expectedKey = process.env.FREEZER_API_KEY;
  if (!expectedKey) return json(503, { erro: "FREEZER_API_KEY não configurada." });

  const providedKey =
    event.headers["x-api-key"] ||
    event.headers["X-API-Key"] ||
    (event.queryStringParameters || {}).apiKey;

  if (!providedKey || providedKey !== expectedKey)
    return json(401, { erro: "Não autorizado." });

  // Diagnóstico das variáveis (sem expor valores sensíveis)
  const diagnostico = {
    FIREBASE_PROJECT_ID:   !!process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY:  !!process.env.FIREBASE_PRIVATE_KEY,
    privateKeyInicio:      (process.env.FIREBASE_PRIVATE_KEY || "").substring(0, 30)
  };

  let data;
  try {
    initAdmin();
    const db       = admin.firestore();
    const snapshot = await db.collection(COLLECTION).doc(DOC_ID).get();
    if (!snapshot.exists) return json(404, { erro: "Documento não encontrado." });
    data = snapshot.data();
  } catch (err) {
    return json(500, {
      erro:        "Erro ao consultar o banco de dados.",
      detalhe:     err.message,
      diagnostico  // mostra quais variáveis estão presentes para debug
    });
  }

  const rooms     = Array.isArray(data.rooms)     ? data.rooms     : [];
  const freezers  = Array.isArray(data.freezers)  ? data.freezers  : [];
  const contracts = Array.isArray(data.contracts) ? data.contracts : [];
  const afericoes = Array.isArray(data.afericoes) ? data.afericoes : [];

  const lastAfericao = afericoes.length ? afericoes[afericoes.length - 1] : null;
  const realUsageMap = {};
  if (lastAfericao?.items) {
    lastAfericao.items.forEach(item => {
      realUsageMap[item.contractId] = {
        espacoReal:   item.realCm,
        dataAfericao: lastAfericao.date,
        statusUso:    item.deviationType === "above" ? "acima_do_contrato"
                    : item.deviationType === "below" ? "abaixo_do_contrato"
                    : "conforme"
      };
    });
  }

  const freezerMap = Object.fromEntries(freezers.map(f => [f.id, f]));
  const roomMap    = Object.fromEntries(rooms.map(r => [r.id, r]));
  const params     = event.queryStringParameters || {};

  let clientes = contracts
    .filter(c => c.status === "active")
    .map(c => {
      const freezer = freezerMap[c.freezerId] || {};
      const room    = roomMap[freezer.roomId]  || {};
      const aferido = realUsageMap[c.id]       || null;
      return {
        cliente:          c.clientName,
        sala:             room.name    || "Sem sala",
        freezer:          freezer.name || "Sem freezer",
        plano:            PLANS[c.planKey] || c.planKey,
        espacoContratado: c.occupiedCm,
        espacoOcupado:    aferido ? aferido.espacoReal : c.occupiedCm,
        unidade:          "cm",
        ...(aferido
          ? { ultimaAfericao: aferido.dataAfericao, statusUso: aferido.statusUso }
          : { observacao: "Sem aferição — valor reflete o contrato" })
      };
    });

  if (params.cliente) clientes = clientes.filter(c => c.cliente.toLowerCase().includes(params.cliente.toLowerCase()));
  if (params.sala)    clientes = clientes.filter(c => c.sala.toLowerCase().includes(params.sala.toLowerCase()));
  if (params.freezer) clientes = clientes.filter(c => c.freezer.toLowerCase().includes(params.freezer.toLowerCase()));

  return json(200, {
    geradoEm:  new Date().toISOString(),
    total:     clientes.length,
    ...(lastAfericao && { ultimaAfericao: lastAfericao.date }),
    clientes
  });
};
