import {kinds,type Job} from './types.ts';
const completionMonth=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'});
export function matchesResult(job:Job,filters:{query?:string;month?:string;status?:string}) {
  const {query='',month='',status=''}=filters;
  return `${job.name} ${job.code}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'))
    && (!month || (job.completed_at?completionMonth.format(new Date(job.completed_at)):job.validity.slice(0,7))===month)
    && (!status || (status==='Finalizado'?kinds.every(k=>job[k]==='Finalizado'):kinds.some(k=>job[k]===status)));
}
