function ascii(value){return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^ -~]/g,"?")}
function esc(value){return ascii(value).replace(/([\\()])/g,"\\$1")}
function line(value,x,y,size=11){return `BT /F1 ${size} Tf ${x} ${y} Td (${esc(value)}) Tj ET`}
function money(cents){return `EUR ${new Intl.NumberFormat("nl-NL",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(cents||0)/100)}`}
function status(value){return({paid:"Betaald",pending:"In behandeling",sent:"Openstaand",cancelled:"Geannuleerd"})[value]||String(value||"")}

export function receiptPdf({organization,member,receipt}){
  const name=member.name||`${member.firstName||""} ${member.lastName||""}`.trim(),commands=[
    "0.04 0.19 0.17 rg",line(organization,54,790,14),line("KWITANTIE",54,740,24),
    "0.82 0.66 0.31 RG 2 w 54 720 m 541 720 l S","0.04 0.19 0.17 rg",
    line(`Kwitantienummer: ${receipt.number}`,54,680,11),line(`Periode: ${String(receipt.periodKey||"").slice(0,7)}`,54,658,11),line(`Status: ${status(receipt.status)}`,54,636,11),
    line("Ontvangen van",54,585,10),line(name,54,558,14),line(member.address||"",54,536,10),line([member.postalCode,member.city].filter(Boolean).join(" "),54,518,10),
    "0.94 0.97 0.95 rg 54 385 487 90 re f","0.04 0.19 0.17 rg",line(receipt.description||"Doorlopende donatie",72,440,13),line(money(receipt.amountCents),420,420,18),
    line("Deze kwitantie is digitaal aangemaakt in het donateursportaal.",54,92,9),line(`Gegenereerd op ${new Date().toLocaleDateString("nl-NL")}`,54,72,9)
  ];
  const stream=commands.join("\n"),objects=[null,"<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];let pdf="%PDF-1.4\n",offsets=[0];for(let i=1;i<objects.length;i++){offsets[i]=Buffer.byteLength(pdf);pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;for(let i=1;i<objects.length;i++)pdf+=`${String(offsets[i]).padStart(10,"0")} 00000 n \n`;pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(pdf)
}
