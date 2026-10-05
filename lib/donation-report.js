const day=value=>String(value||"").slice(0,10);
const add=(map,key,amountCents)=>{const item=map.get(key)||{label:key,count:0,amountCents:0};item.count++;item.amountCents+=Number(amountCents||0);map.set(key,item)};

export function donationReport(tenant,{from,to}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw Error("Kies een geldige periode.");
  const inRange=value=>{const date=day(value);return date>=from&&date<=to},transactions=[];
  for(const donation of tenant.donations||[]){
    if(donation.status!=="completed")continue;
    const occurredAt=donation.completedAt||donation.createdAt;if(!inRange(occurredAt))continue;
    transactions.push({id:donation.id||donation.orderId,date:occurredAt,amountCents:Number(donation.amountCents||0),type:"Losse donatie",method:donation.provider||"Onbekend",source:donation.source==="kiosk"?"Donatiescherm":donation.source||"Onbekend",reference:donation.orderId||""});
  }
  for(const receipt of tenant.receipts||[]){
    if(receipt.status!=="paid")continue;
    const occurredAt=receipt.paidAt||receipt.createdAt;if(!inRange(occurredAt))continue;
    const payment=(tenant.memberPayments||[]).find(item=>item.status==="paid"&&Array.isArray(item.receiptIds)&&item.receiptIds.includes(receipt.id));
    transactions.push({id:receipt.id,date:occurredAt,amountCents:Number(receipt.amountCents||0),type:"Doorlopende donatie",method:payment?.provider||"Donateursportaal",source:"Doorlopende donateur",reference:payment?.orderId||receipt.number||""});
  }
  transactions.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const methods=new Map(),types=new Map(),sources=new Map(),days=new Map();
  for(const item of transactions){add(methods,item.method,item.amountCents);add(types,item.type,item.amountCents);add(sources,item.source,item.amountCents);add(days,day(item.date),item.amountCents)}
  const totalCents=transactions.reduce((sum,item)=>sum+item.amountCents,0),breakdown=map=>[...map.values()].sort((a,b)=>b.amountCents-a.amountCents);
  return{from,to,summary:{count:transactions.length,totalCents,averageCents:transactions.length?Math.round(totalCents/transactions.length):0},byMethod:breakdown(methods),byType:breakdown(types),bySource:breakdown(sources),byDay:[...days.values()].sort((a,b)=>a.label.localeCompare(b.label)),transactions};
}
