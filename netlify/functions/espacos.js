/**
 * API somente leitura — usa Firestore REST API
 * Não precisa de firebase-admin nem de chave privada
 * Usa apenas FIREBASE_PROJECT_ID e FIREBASE_API_KEY
 */

const https = require("https");

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

function fetchFirestoreDoc(projectId, apiKey) {
  return new Promise((resolve, reject) => {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${COLLECTION}/${DOC_ID}?key=${apiKey}`;
    https.get(url, (res) => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error("Resposta inválida do Firestore")); }
      });
    }).on("error", reject);
  });
}

function parseFirestoreValue(val) {
  if (!val) return null;
  if (val.stringValue  !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return Number(val.integerValue);
  if (val.doubleValue  !== undefined) return Number(val.doubleValue);
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.nullValue    !== undefined) return null;
  if (val.arrayValue)  return (val.arrayValue.values || []).map(parseFirestoreValue);
  if (val.mapValue)    return parseFirestoreFields(val.mapValue.fields || {});
  return null;
}

function parseFirestoreFields(fields) {
  const obj = {};
  for (const [key, val] of Object.entries(fields)) {
    obj[key] = parseFirestoreValue(val);
  }
  return obj;
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

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const apiKey    = process.env.FIR
};
