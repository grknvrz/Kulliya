import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("donatiebedragen zijn geldige hele euro's", async () => {
  const data = JSON.parse(await readFile(new URL("../config/donations.json", import.meta.url)));
  assert.ok(data.amounts.length > 0);
  assert.ok(data.amounts.every(value => Number.isInteger(value) && value > 0));
  assert.equal(data.currency, "EUR");
});
