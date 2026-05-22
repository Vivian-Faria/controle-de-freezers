const https = require("https");
const COLLECTION = "sistemas";
const DOC_ID = "gestao-freezers";
const PLANS = { quarter:"1/4", half:"1/2", threeQuarter:"3/4", full:"1" };
const CORS = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"GET, OPTIONS", "Access-Control-Allow-Headers":"Content-Type, X-API-Key" };

function json(code, body) {
  return { statusCode: code, headers: { "Content-Type":"application/json; charset=utf-8", ...CORS }, body: JSON.stringify(body, null, 2) };
}

function fetchDoc(projectId, apiKey) {
  return new Promise((resolve, reject) => {
    const url = "https://firestore.googleapis.com/v1/projects/" + projectId + "/databases/(default)/documents/" + COLLECTION + "/" + DOC_ID + "?key=" + apiKey;
    https.get(url, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(e); } });
    }).on("error", reject);
  });
}

function parseVal(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.arrayValue) return (v.arrayValue.values || []).map(parseVal);
  if (v.mapValue) return parseFields(v.mapValue.fields || {});
  return null;
}

function parseFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) obj[k] = parseVal(v);
  return obj;
}

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET") return json(405, { erro: "Use GET." });

  const expectedKey = process.env.FREEZER_API_KEY;
  if (!expectedKey) return json(503, { erro: "FREEZER_API_KEY nao configurada." });

  const params = event.queryStringParameters || {};
  const providedKey = (event.headers["x-api-key"] || event.headers["X-API-Key"] || params.apiKey);
  if (!providedKey || providedKey !== expectedKey) return json(401, { erro: "Nao autorizado." });

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!projectId || !apiKey) return json(503, { erro: "Firebase nao configurado." });

  let data;
  try {
    const doc = await fetchDoc(projectId, apiKey);
    if (doc.error) return json(500, { erro: "Firestore erro.", detalhe: doc.error.message });
    if (!doc.fields) return json(404, { erro: "Documento nao encontrado." });
    data = parseFields(doc.fields);
  } catch(err) {
    return json(500, { erro: "Erro ao consultar.", detalhe: err.message });
  }

  const rooms = Array.isArray(data.rooms) ? data.rooms : [];
  const freezers = Array.isArray(data.freezers) ? data.freezers : [];
  const contracts = Array.isArray(data.contracts) ? data.contracts : [];
  const freezerMap = Object.fromEntries(freezers.map(f => [f.id, f]));
  const roomMap = Object.fromEntries(rooms.map(r => [r.id, r]));

  let clientes = contracts.filter(c => c.status === "active").map(c => {
    const freezer = freezerMap[c.freezerId] || {};
    const room = roomMap[freezer.roomId] || {};
    return {
      cliente: c.clientName,
      sala: room.name || "Sem sala",
      freezer: freezer.name || "Sem freezer",
      plano: PLANS[c.planKey] || c.planKey,
      espacoContratado: c.occupiedCm,
      espacoOcupado: c.occupiedCm,
      unidade: "cm"
    };
  });

  if (params.cliente) clientes = clientes.filter(c => c.cliente.toLowerCase().includes(params.cliente.toLowerCase()));
  if (params.sala) clientes = clientes.filter(c => c.sala.toLowerCase().includes(params.sala.toLowerCase()));
  if (params.freezer) clientes = clientes.filter(c => c.freezer.toLowerCase().includes(params.freezer.toLowerCase()));

  return json(200, { geradoEm: new Date().toISOString(), total: clientes.length, clientes });
};
