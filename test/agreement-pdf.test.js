import test from "node:test";
import assert from "node:assert/strict";
import { agreementPdf } from "../lib/agreement-pdf.js";

test("vergaderafspraak wordt als een geldige enkelvoudige A4-PDF opgebouwd", () => {
  const pdf = agreementPdf({
    organization: "Testmoskee",
    meetingTitle: "Bestuursvergadering",
    date: "2026-10-06",
    agreement: { agreementText: "Het bestuur stemt in met deze afspraak.", signatures: {} },
    members: [{ id: "member-1", name: "Voorbeeld Bestuurder", role: "Voorzitter" }]
  });

  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 8).toString(), "%PDF-1.4");
  assert.match(pdf.toString("latin1"), /VERGADERAFSPRAAK/);
  assert.match(pdf.toString("latin1"), /Voorbeeld Bestuurder/);
  assert.match(pdf.toString("latin1"), /\/MediaBox \[0 0 595 842\]/);
});
