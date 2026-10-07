import { demoRequest } from './demo';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { matchesResult } from './result-filters';
import { kinds, type State } from './types';
export const DEMO_MODE = true;
export async function api<T>(path:string,body?:unknown,_signal?:AbortSignal):Promise<T>{return await demoRequest(path,body) as T;}
export async function downloadReport(month:string,status='',query=''){
  const state=await demoRequest('state') as State;
  const jobs=state.jobs.filter(job=>matchesResult(job,{month,status,query})&&kinds.every(kind=>['Finalizado','Finalizado (com avisos)'].includes(job[kind])));
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  let page=pdf.addPage(),y=790;
  function line(text:string){if(y<60){page=pdf.addPage();y=790;}page.drawText(text,{x:40,y,size:11,font});y-=20;}
  line('Renovacoes - Demonstracao');line('Dados ficticios. Sem validade documental.');line(`Competencia: ${month||'Todas'}`);y-=10;
  for(const job of jobs){line(`${job.code} | ${job.name}`);for(const kind of kinds)line(`${kind.toUpperCase()}: ${job[kind]}`);y-=10;}
  if(!jobs.length)line('Sem resultados finalizados para estes filtros.');
  const bytes=await pdf.save();
  const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/pdf'}));
  const link=document.createElement('a');link.href=url;link.download=`renovacoes-demonstracao-${month||'todas'}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
