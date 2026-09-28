import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const collections = ["words", "phrases", "mediaPhrases"];
const maxBodyBytes = 1024 * 1024;

class RequestError extends Error {}

const sendJson = (response, status, value) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
};

const readBody = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new RequestError("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const validateState = (state) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new RequestError("Expected a state object.");
  if (!Number.isInteger(state.goal) || state.goal < 1 || state.goal > 240) throw new RequestError("Daily goal must be between 1 and 240 minutes.");
  for (const collection of collections) {
    if (!Array.isArray(state[collection]) || state[collection].length > 5000) throw new RequestError(`Invalid ${collection} collection.`);
    const ids = new Set();
    for (const entry of state[collection]) {
      if (!entry || typeof entry.id !== "string" || entry.id.length > 120 || ids.has(entry.id)) throw new RequestError(`Invalid entry in ${collection}.`);
      ids.add(entry.id);
      if (typeof entry.sv !== "string" || !entry.sv.trim() || entry.sv.length > 240) throw new RequestError(`Invalid Swedish text in ${collection}.`);
      if (typeof entry.en !== "string" || !entry.en.trim() || entry.en.length > 320) throw new RequestError(`Invalid translation in ${collection}.`);
      for (const field of ["pronunciation", "example", "source", "note"]) {
        if (entry[field] !== undefined && (typeof entry[field] !== "string" || entry[field].length > 1000)) throw new RequestError(`Invalid ${field} in ${collection}.`);
      }
    }
  }
  if (!state.logs || typeof state.logs !== "object" || Array.isArray(state.logs) || Object.keys(state.logs).length > 5000) throw new RequestError("Invalid study logs.");
  for (const [date, log] of Object.entries(state.logs)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !log || typeof log !== "object" || Array.isArray(log)) throw new RequestError("Invalid study log.");
    for (const field of ["minutes", "wordsAdded", "cardsAdded", "reviews", "learned"]) {
      if (log[field] !== undefined && (!Number.isInteger(log[field]) || log[field] < 0 || log[field] > 1000000)) throw new RequestError(`Invalid ${field} in study log.`);
    }
  }
};

export const createAppServer = ({ databasePath = resolve(projectRoot, "data", "hej.sqlite"), webRoot = projectRoot } = {}) => {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      daily_goal INTEGER NOT NULL CHECK (daily_goal BETWEEN 1 AND 240)
    );
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      collection TEXT NOT NULL CHECK (collection IN ('words', 'phrases', 'mediaPhrases')),
      swedish TEXT NOT NULL,
      english TEXT NOT NULL,
      pronunciation TEXT NOT NULL DEFAULT '',
      example TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS entries_by_collection_position ON entries(collection, position);
    CREATE TABLE IF NOT EXISTS study_logs (
      date TEXT PRIMARY KEY,
      minutes INTEGER NOT NULL DEFAULT 0,
      words_added INTEGER NOT NULL DEFAULT 0,
      cards_added INTEGER NOT NULL DEFAULT 0,
      reviews INTEGER NOT NULL DEFAULT 0,
      learned INTEGER NOT NULL DEFAULT 0
    );
  `);

  const getSettings = database.prepare("SELECT daily_goal FROM settings WHERE id = 1");
  const getEntries = database.prepare("SELECT id, collection, swedish, english, pronunciation, example, source, note FROM entries ORDER BY collection, position");
  const getLogs = database.prepare("SELECT date, minutes, words_added, cards_added, reviews, learned FROM study_logs ORDER BY date");
  const insertEntry = database.prepare("INSERT INTO entries (id, collection, swedish, english, pronunciation, example, source, note, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertLog = database.prepare("INSERT INTO study_logs (date, minutes, words_added, cards_added, reviews, learned) VALUES (?, ?, ?, ?, ?, ?)");
  const upsertSettings = database.prepare("INSERT INTO settings (id, daily_goal) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET daily_goal = excluded.daily_goal");
  const saveTransaction = (state) => {
    database.exec("BEGIN IMMEDIATE;");
    try {
      upsertSettings.run(state.goal);
      database.exec("DELETE FROM entries; DELETE FROM study_logs;");
      for (const collection of collections) {
        state[collection].forEach((entry, position) => insertEntry.run(
          entry.id,
          collection,
          entry.sv,
          entry.en,
          entry.pronunciation || "",
          entry.example || "",
          entry.source || "",
          entry.note || "",
          position
        ));
      }
      for (const [date, log] of Object.entries(state.logs)) {
        insertLog.run(date, log.minutes || 0, log.wordsAdded || 0, log.cardsAdded || 0, log.reviews || 0, log.learned || 0);
      }
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  };

  const readState = () => {
    const settings = getSettings.get();
    if (!settings) return null;
    const state = { goal: settings.daily_goal, words: [], phrases: [], mediaPhrases: [], logs: {} };
    for (const entry of getEntries.all()) {
      state[entry.collection].push({
        id: entry.id,
        sv: entry.swedish,
        en: entry.english,
        pronunciation: entry.pronunciation,
        example: entry.example,
        ...(entry.source ? { source: entry.source } : {}),
        ...(entry.note ? { note: entry.note } : {})
      });
    }
    for (const log of getLogs.all()) {
      state.logs[log.date] = { minutes: log.minutes, wordsAdded: log.words_added, cardsAdded: log.cards_added, reviews: log.reviews, learned: log.learned };
    }
    return state;
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname === "/api/state" && request.method === "GET") {
      sendJson(response, 200, readState());
      return;
    }
    if (url.pathname === "/api/state" && request.method === "PUT") {
      try {
        const state = await readBody(request);
        validateState(state);
        saveTransaction(state);
        sendJson(response, 200, { saved: true });
      } catch (error) {
        const badRequest = error instanceof SyntaxError || error instanceof RequestError;
        sendJson(response, badRequest ? 400 : 500, { error: badRequest ? error.message : "Unable to save state." });
      }
      return;
    }
    if (request.method !== "GET" || !["/", "/index.html"].includes(url.pathname)) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(await readFile(resolve(webRoot, "index.html")));
  });
  server.on("close", () => database.close());
  return server;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 4173);
  const server = createAppServer({ databasePath: process.env.HEJ_DB_PATH || resolve(projectRoot, "data", "hej.sqlite") });
  server.listen(port, host, () => console.log(`hej! is running at http://${host}:${port}`));
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
