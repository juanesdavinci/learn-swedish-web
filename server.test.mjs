import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAppServer } from "./server.mjs";

test("serves the app and round-trips validated state through SQLite", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "hej-test-"));
  const server = createAppServer({ databasePath: join(directory, "test.sqlite") });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Hej, ready for a little Swedish\?/);

  const empty = await fetch(`${baseUrl}/api/state`);
  assert.equal(await empty.json(), null);

  const state = {
    goal: 15,
    words: [{ id: "w1", sv: "fika", en: "coffee break", pronunciation: "fee-ka", example: "Ta en fika." }],
    phrases: [{ id: "p1", sv: "Hej!", en: "Hello!", pronunciation: "hey", example: "" }],
    mediaPhrases: [{ id: "m1", sv: "Bra låt.", en: "Good song.", pronunciation: "", example: "", source: "Song · test", note: "A short note." }],
    logs: { "2026-09-28": { minutes: 4, wordsAdded: 1, cardsAdded: 2, reviews: 3, learned: 1 } }
  };
  const saved = await fetch(`${baseUrl}/api/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state)
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(await (await fetch(`${baseUrl}/api/state`)).json(), state);

  const invalid = await fetch(`${baseUrl}/api/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...state, goal: 0 })
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await (await fetch(`${baseUrl}/api/state`)).json(), state);
});
