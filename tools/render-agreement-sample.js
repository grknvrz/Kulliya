import { mkdir, writeFile } from "node:fs/promises";
import { agreementPdf } from "../lib/agreement-pdf.js";
await mkdir(new URL("../output/pdf/",import.meta.url),{recursive:true});
const members=[{id:"1",name:"Gürkan Navruz",role:"Voorzitter"},{id:"2",name:"Fatima El Amrani",role:"Secretaris"},{id:"3",name:"Yusuf Kaya",role:"Penningmeester"},{id:"4",name:"Aylin Demir",role:"Bestuurslid"}];
const signatures={"1":{strokes:[[{x:.08,y:.25},{x:.2,y:.66},{x:.34,y:.31},{x:.48,y:.72},{x:.62,y:.38},{x:.82,y:.62}]]},"2":{strokes:[[{x:.1,y:.4},{x:.28,y:.7},{x:.44,y:.35},{x:.58,y:.62},{x:.83,y:.46}]]}};
const pdf=agreementPdf({organization:"Eyüp Sultan Moskee",meetingTitle:"Bestuursvergadering oktober",date:"2026-10-06",agreement:{agreementText:"Het bestuur spreekt af dat de jaarlijkse onderhoudswerkzaamheden uiterlijk voor 1 december worden ingepland en uitgevoerd.",signatures},members});
await writeFile(new URL("../output/pdf/voorbeeld-vergaderafspraak.pdf",import.meta.url),pdf);
