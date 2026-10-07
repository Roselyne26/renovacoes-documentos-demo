// Adaptador exclusivo da prévia. Nenhuma integração externa ou persistência.
import { kinds, type State, type Job, type Candidate, type Dashboard } from "./types";
export const localMonth = (stamp = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(stamp);
const finished = (job: Job) => kinds.every(k => ["Finalizado", "Finalizado (com avisos)"].includes(job[k]));
const companyNames = ["Clínica Exemplo", "Comércio Demonstração", "Indústria Modelo", "Serviços Exemplo"];
const candidates: Candidate[] = companyNames.map((name, index) => ({ code: `DEMO-${1001 + index}`, name, ltcat_validity: "" }));
const jobs: Job[] = [];
const completed = new Map<number, { month: string; documents: string[] }>();
let snapshot: { token: string; month: string; codes: string[] } | null = null;
const batch: State["batch"] = { active: false, processed: 0, total: 0, current_name: "", message: "", completed: 0, attention: 0, skipped: 0 };
let initialized = false;
function makeJob(candidate: Candidate, month: string): Job {
  return { id: jobs.length + 1, code: candidate.code, name: candidate.name, validity: `${month}-01`,
    ltcat: "Pendente", pgr: "Pendente", pcmso: "Pendente", warnings: [], manual_notes: "", message: "Aguardando renovação.", legacy_candidate: false, legacy_confirmed: false };
}
function seed() {
  if (initialized) return;
  initialized = true;
  const month = localMonth(), prior = new Date(`${month}-15T12:00:00-03:00`);
  prior.setUTCMonth(prior.getUTCMonth() - 1);
  const overdue = makeJob(candidates[3], localMonth(prior)); jobs.push(overdue);
  for (let i = 0; i < 2; i++) {
    const job = makeJob(candidates[i], month);
    job.ltcat = "Finalizado"; job.pgr = "Finalizado"; job.pcmso = i === 1 ? "Finalizado (com avisos)" : "Finalizado";
    job.warnings = i === 1 ? ["Exemplo de aviso: conferir informação cadastral do estabelecimento."] : [];
    job.message = "Renovação concluída (demonstração).";
    jobs.push(job); completed.set(job.id, { month, documents: i === 0 ? ["pcmso"] : kinds });
  }
}
function dashboard(month: string): Dashboard {
  const active = jobs.filter(j => completed.get(j.id)?.month === month);
  const overdue = jobs.filter(j => !finished(j) && j.validity.slice(0,7) < localMonth() && j.validity.slice(0,7) <= month);
  return { month, companies: new Set(active.filter(finished).map(j => j.code)).size, served: new Set(active.map(j => j.code)).size,
    warnings: new Set(active.filter(j => j.warnings.length).map(j => j.code)).size, overdue_count: new Set(overdue.map(j => j.code)).size, overdue,
    documents: Object.fromEntries(kinds.map(k => [k, active.filter(j => completed.get(j.id)?.documents.includes(k)).length])) as Dashboard["documents"], untracked: 0 };
}
export async function demoRequest(path: string, body?: unknown): Promise<unknown> {
  seed();
  const url = new URL(path, "http://demo.local/");
  const payload = body as { month?: string; search_token?: string; codes?: string[] } | undefined;
  let result: unknown;
  if (url.pathname === "/state") result = { mode: "demo", jobs, execution_enabled: true, bulk_enabled: true, batch } satisfies State;
  else if (url.pathname === "/dashboard") result = dashboard(url.searchParams.get("month") || localMonth());
  else if (url.pathname === "/renewals/search") {
    if (!/^\d{4}-\d{2}$/.test(payload?.month || "")) throw new Error("Escolha o mês e ano.");
    snapshot = { token: crypto.randomUUID(), month: payload!.month!, codes: candidates.map(c => c.code) };
    result = { search_token: snapshot.token, month: snapshot.month, demo: true, records: candidates.map(c => ({ ...c, ltcat_validity: `${snapshot!.month}-01` })) };
  } else if (url.pathname === "/renewals/start") {
    const selection = payload?.codes;
    if (batch.active) throw new Error("Aguarde a demonstração em andamento.");
    if (!snapshot || snapshot.token !== payload?.search_token || !selection?.length || selection.some(c => !snapshot!.codes.includes(c))) throw new Error("Busque os estabelecimentos e marque a seleção.");
    const work = selection.map(code => {
      let job = jobs.find(j => j.code === code && j.validity === `${snapshot!.month}-01`);
      if (!job) { job = makeJob(candidates.find(c => c.code === code)!, snapshot!.month); jobs.push(job); }
      return job;
    }).filter(j => !finished(j));
    if (!work.length) throw new Error("As empresas selecionadas já estão finalizadas nesta demonstração.");
    Object.assign(batch, { active: true, total: work.length, processed: 0, completed: 0, attention: 0, skipped: 0, message: "" });
    work.forEach((job, index) => {
      setTimeout(() => { batch.current_name = job.name; kinds.forEach(k => { if (job[k] === "Pendente") job[k] = "Em andamento"; }); }, index * 1600);
      setTimeout(() => {
        const documents = kinds.filter(k => job[k] === "Em andamento");
        kinds.forEach(k => { job[k] = "Finalizado"; }); job.message = "Renovação simulada concluída.";
        completed.set(job.id, { month: localMonth(), documents }); batch.processed++; batch.completed++;
        if (batch.processed === batch.total) { batch.active = false; batch.current_name = ""; batch.message = "Demonstração concluída."; }
      }, (index + 1) * 1600);
    });
    result = { ok: true };
  } else if (/^\/jobs\/\d+\/plan$/.test(url.pathname)) result = { actions: ["Conferir as vigências de LTCAT e PGR.", "Preservar os documentos já prontos e renovar as etapas necessárias.", "Conferir LTCAT e PGR antes de iniciar PCMSO."], blockers: ["Prévia com dados fictícios. Nenhum documento real será alterado."] };
  else if (/^\/jobs\/\d+\/history$/.test(url.pathname)) result = { events: [{ at: new Date().toISOString(), message: "Dados fictícios da demonstração do frontend." }] };
  else throw new Error("Ação indisponível na demonstração.");
  return structuredClone(result);
}
