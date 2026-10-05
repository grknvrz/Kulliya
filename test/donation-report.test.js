import test from "node:test";
import assert from "node:assert/strict";
import { donationReport } from "../lib/donation-report.js";

test("rapport groepeert losse en doorlopende donaties binnen de gekozen periode",()=>{
  const tenant={donations:[{id:"a",orderId:"D1",amountCents:500,provider:"CCV",source:"kiosk",status:"completed",completedAt:"2026-09-10T10:00:00Z"},{id:"b",amountCents:900,status:"completed",completedAt:"2026-08-31T23:00:00Z"}],receipts:[{id:"r1",number:"KW-1",amountCents:12000,status:"paid",paidAt:"2026-09-15T10:00:00Z"}],memberPayments:[{orderId:"M1",status:"paid",receiptIds:["r1"],provider:"MultiSafepay"}]};
  const report=donationReport(tenant,{from:"2026-09-01",to:"2026-09-30"});
  assert.equal(report.summary.count,2);assert.equal(report.summary.totalCents,12500);assert.equal(report.byType.find(item=>item.label==="Losse donatie").amountCents,500);assert.equal(report.byMethod.find(item=>item.label==="MultiSafepay").count,1);
});

test("rapport weigert een omgekeerde periode",()=>assert.throws(()=>donationReport({},{from:"2026-10-01",to:"2026-09-01"}),/geldige periode/));
