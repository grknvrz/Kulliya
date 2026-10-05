import test from "node:test";
import assert from "node:assert/strict";
import { receiptPdf } from "../lib/receipt-pdf.js";

test("donateurskwitantie wordt als downloadbare PDF opgebouwd",()=>{
  const pdf=receiptPdf({organization:"Stichting Moskee",member:{name:"A. Donateur",address:"Straat 1",postalCode:"1234 AB",city:"Utrecht"},receipt:{number:"KW-2026-00001",periodKey:"2026-10",description:"Doorlopende donatie",amountCents:12000,status:"paid"}});
  assert.equal(pdf.subarray(0,8).toString(),"%PDF-1.4");
  assert.match(pdf.toString(),/KW-2026-00001/);
  assert.match(pdf.toString(),/A\. Donateur/);
});
