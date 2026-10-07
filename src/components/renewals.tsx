"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {matchesResult} from "@/lib/result-filters";
import { api, DEMO_MODE, downloadReport } from "@/lib/api";
import { localMonth } from "@/lib/demo";
import { kinds, type Candidate, type Dashboard, type History, type Job, type Plan, type SearchResult, type State } from "@/lib/types";

const dateLabel = (value: string | null) => value ? value.split("-").reverse().join("/") : "Não informado";
const selectionKey = (candidate: Candidate) => candidate.selection_key || candidate.code;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir a ação.";
const POLL_INTERVAL = DEMO_MODE ? 4000 : 30000;
const PAGE_SIZE = 25;
const statusClass = (value: string) => value.includes("avisos") ? "warning" : value === "Finalizado" ? "done" : value === "Erro" ? "error" : value === "Em andamento" ? "running" : "";

export default function Renewals({correctionsEnabled=false,webLoginEnabled=false}:{correctionsEnabled?:boolean;webLoginEnabled?:boolean}) {
  const [view, setView] = useState<'overview'|'selection'|'results'|'corrections'>('overview');
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidatePage, setCandidatePage] = useState(1);
  const [resultPage, setResultPage] = useState(1);
  const [overduePage, setOverduePage] = useState(1);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [dashboardRefresh, setDashboardRefresh] = useState(0);
  const activeRef = useRef(false);
  const [state, setState] = useState<State | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardMonth, setDashboardMonth] = useState("");
  const [renewalMonth, setRenewalMonth] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [reportMonth, setReportMonth] = useState("");
  const [status, setStatus] = useState("");
  const [feedback, setFeedback] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [dashboardError, setDashboardError] = useState("");
  const [operationBusy, setBusy] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [bulkRetry,setBulkRetry]=useState<{processed:number;total:number;accepted:number;blocked:string[]}|null>(null);
  const busy=retrying!==null?`retry-${retrying}`:operationBusy;
  const [details, setDetails] = useState<{ job: Job; plan?: Plan; events?: History["events"]; error?: string; loading: boolean } | null>(null);
  const detailVersion = useRef(0);
  const searchVersion = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => { const month=localMonth(); setDashboardMonth(month); setRenewalMonth(month); }, []);

  const refresh = useCallback(async () => {
    try { const next=await api<State>("state"); activeRef.current=next.batch.active; setState(next); setConnectionError(""); }
    catch (error) { setConnectionError(errorMessage(error)); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false, lastLoad = 0;
    const load = async (force=false) => {
      if (pending || document.hidden || (!force && Date.now()-lastLoad < (activeRef.current ? POLL_INTERVAL : 120000))) return;
      lastLoad=Date.now();
      pending = true;
      try { const next = await api<State>("state", undefined, controller.signal); if (!controller.signal.aborted) { activeRef.current=next.batch.active; setState(next); setConnectionError(""); } }
      catch (error) { if (!controller.signal.aborted) setConnectionError(errorMessage(error)); }
      finally { pending = false; }
    };
    const visible = () => { if(!document.hidden) void load(true); };
    document.addEventListener("visibilitychange",visible);
    void load(true); const timer = setInterval(() => void load(), POLL_INTERVAL);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange",visible); };
  }, []);

  useEffect(() => {
    if (!dashboardMonth) {setDashboard(null); return;}
    const controller = new AbortController(); let pending = false, lastLoad=0;
    setDashboard(null); setDashboardError("");
    const load = async (force=false) => {
      if (pending || document.hidden || (!force && lastLoad && Date.now()-lastLoad < (activeRef.current ? POLL_INTERVAL : 120000))) return; lastLoad=Date.now(); pending = true;
      try { const result = await api<Dashboard>(`dashboard?month=${encodeURIComponent(dashboardMonth)}`, undefined, controller.signal); if (!controller.signal.aborted) { setDashboard(result); setDashboardError(""); } }
      catch (error) { if (!controller.signal.aborted) setDashboardError(errorMessage(error)); }
      finally { pending = false; }
    };
    const visible = () => {if(!document.hidden) void load(true);};
    document.addEventListener("visibilitychange",visible);
    void load(true); const timer = setInterval(() => void load(), POLL_INTERVAL);
    return () => { controller.abort(); clearInterval(timer);document.removeEventListener("visibilitychange",visible); };
  }, [dashboardMonth, dashboardRefresh]);

  useEffect(() => {
    if (details && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [details]);

  async function search() {
    const version = ++searchVersion.current;
    setBusy("search"); setFeedback(""); setSearchResult(null); setChosen(new Set());
    try {
      const result = await api<SearchResult>("renewals/search", { month: renewalMonth });
      if (version !== searchVersion.current) return;
      setCandidatePage(1); setCandidateQuery(""); setSearchResult(result); setChosen(new Set(result.records.map(selectionKey))); 
      const restricted=(result as SearchResult & {scope_restricted?:boolean}).scope_restricted;
      setFeedback(result.records.length ? `${result.records.length} estabelecimentos encontrados. Revise a seleção.${restricted?' A busca está limitada aos códigos autorizados no piloto.':''}` : restricted?"Nenhuma pendência entre os códigos autorizados no piloto. A configuração DEMO_CODES limita a busca neste servidor.":"Nenhuma pendência confirmada no sistema de demonstração até o mês escolhido, incluindo os atrasados.");
    } catch (error) { if (version === searchVersion.current) setFeedback(errorMessage(error)); }
    finally { setBusy(null); }
  }

  async function retry(job:Job) {
    if(retrying!==null)return;
    setRetrying(job.id);setFeedback('');
    try {
      await api(`jobs/${job.id}/retry`,{});
      closeDetails();
      await refresh();setDashboardRefresh(v=>v+1);
      setFeedback('Nova tentativa preparada. Etapas confirmadas não serão repetidas.');
    }catch(error){const message=errorMessage(error);setFeedback(message);setDetails(current=>current?.job.id===job.id?{...current,error:message}:current);}
    finally{setRetrying(null);}
  }

  async function retryWarnings() {
    if(busy)return;
    const selected=jobs.filter(j=>j.completed_at && j.message==='Finalizado (com avisos)');
    if(!selected.length)return;
    closeDetails();setRetrying(-1);setFeedback('');
    let accepted=0;
    const blocked:string[]=[];
    setBulkRetry({processed:0,total:selected.length,accepted,blocked:[]});
    try {
      for(let i=0;i<selected.length;i++) {
        const job=selected[i];
        try {await api(`jobs/${job.id}/retry`,{});accepted++;}
        catch(error){blocked.push(`${job.name}: ${errorMessage(error)}`);}
        setBulkRetry({processed:i+1,total:selected.length,accepted,blocked:[...blocked]});
      }
      await refresh();setDashboardRefresh(v=>v+1);
      setFeedback(`${accepted} nova(s) tentativa(s) preparada(s); ${blocked.length} empresa(s) continuam para conferência. Etapas confirmadas foram preservadas.`);
    }finally{setRetrying(null);}
  }

  async function start() {
    if (!searchResult) return;
    setBusy("start"); setFeedback("");
    try { await api("renewals/start", DEMO_MODE ? { search_token: searchResult.search_token, codes: [...chosen] } : { search_token: searchResult.search_token, establishment_ids: [...chosen].map(Number), catalog_generation: searchResult.catalog_generation }); await refresh(); setView("results"); setDashboardRefresh(v=>v+1); setFeedback(DEMO_MODE ? "Simulação iniciada. Nenhuma alteração é feita no sistema de demonstração." : "Renovações iniciadas para as empresas selecionadas."); }
    catch (error) { setFeedback(errorMessage(error)); }
    finally { setBusy(null); }
  }

  async function showDetails(job: Job) {
    const version = ++detailVersion.current;
    setDetails({ job, loading: true });
    try {
      const [history, plan] = await Promise.allSettled([api<History>(`jobs/${job.id}/history`), api<Plan>(`jobs/${job.id}/plan`, {})]);
      if (version === detailVersion.current) setDetails({ job, events: history.status==='fulfilled'?history.value.events:undefined, plan:plan.status==='fulfilled'?plan.value:undefined, error:history.status==='rejected'?errorMessage(history.reason):plan.status==='rejected'?errorMessage(plan.reason):undefined, loading: false });
    } catch (error) { if (version === detailVersion.current) setDetails({ job, error: errorMessage(error), loading: false }); }
  }

  function closeDetails() { detailVersion.current++; dialog.current?.close(); setDetails(null); }
  function toggle(candidate: Candidate) {
    setChosen(previous => { const next = new Set(previous); if (next.has(selectionKey(candidate))) next.delete(selectionKey(candidate)); else next.add(selectionKey(candidate)); return next; });
  }
  const deferredQuery=useDeferredValue(query);
  const deferredCandidateQuery=useDeferredValue(candidateQuery);
  const jobs = useMemo(() => (state?.jobs || []).filter(j => matchesResult(j,{query:deferredQuery,month:reportMonth,status})), [state?.jobs,deferredQuery,reportMonth,status]);
  const candidates = useMemo(()=> (searchResult?.records || []).filter(r=>`${r.name} ${r.code}`.toLocaleLowerCase('pt-BR').includes(deferredCandidateQuery.trim().toLocaleLowerCase('pt-BR'))),[searchResult,deferredCandidateQuery]);
  useEffect(()=>setCandidatePage(1),[deferredCandidateQuery]);
  useEffect(()=>setResultPage(1),[deferredQuery,reportMonth,status]);
  const shownCandidatePage=Math.min(candidatePage,Math.max(1,Math.ceil(candidates.length/PAGE_SIZE)));
  const shownResultPage=Math.min(resultPage,Math.max(1,Math.ceil(jobs.length/PAGE_SIZE)));
  const visibleCandidates=candidates.slice((shownCandidatePage-1)*PAGE_SIZE,shownCandidatePage*PAGE_SIZE);
  const visibleJobs=jobs.slice((shownResultPage-1)*PAGE_SIZE,shownResultPage*PAGE_SIZE);
  const completed = (job:Job) => !!job.completed_at || kinds.every(k=>job[k]==='Finalizado' || job[k]==='Finalizado (com avisos)');
  const finishedCount=jobs.filter(j=>kinds.every(k=>j[k]==='Finalizado') && !j.warnings.length && j.message!=='Erro').length;
  const warningCount=jobs.filter(j=>completed(j) && j.warnings.length && j.message!=='Erro').length;
  const errorCount=jobs.filter(j=>completed(j) && j.message==='Erro').length;
  const batch = state?.batch;
  const retryWarningsCount=jobs.filter(j=>j.completed_at && j.message==='Finalizado (com avisos)').length;
  const retryWarningsButton=!DEMO_MODE && retryWarningsCount>0 && <div className="selection-footer"><p className="helper">Inclui os {retryWarningsCount} resultados com avisos da lista filtrada, em todas as páginas. Cada empresa será conferida no sistema de demonstração; etapas confirmadas não serão repetidas. O sistema de demonstração pode demorar para responder.</p><button className="primary" disabled={!!busy || !state?.execution_enabled || !!connectionError} onClick={()=>void retryWarnings()}>{retrying===-1?'Conferindo empresas…':`Tentar renovar todos com avisos (${retryWarningsCount})`}</button></div>;

  return <>
    <header><a className="brand" href="/" aria-label="Renovações — Demonstração início"><strong>Renovações — Demonstração</strong></a><span className="header-label">Saúde e segurança do trabalho</span><span className="local">Renovações</span></header>
    <main>
      <div className="heading"><div><p className="eyebrow">GESTÃO DE LAUDOS</p><h1>Renovações</h1><p>Consulte, selecione e acompanhe seus documentos.</p></div><span className={`connection-pill ${connectionError ? 'offline' : ''}`}><span aria-hidden="true" />{DEMO_MODE ? 'Demonstração' : connectionError ? 'Sem conexão' : state ? 'Conectado' : 'Conectando…'}</span></div>
      <nav className="workspace-nav" aria-label="Áreas de renovações">{([['overview','Visão geral'],['selection','Renovar laudos'],['results','Resultados'],['corrections','Correções']] as const).filter(([key])=>key!=='corrections'||correctionsEnabled).map(([key,label])=><button key={key} aria-pressed={view===key} className={view===key?'active':''} onClick={()=>{setView(key);setFeedback("");}}>{label}{key==='results' && !!state?.jobs.length && <span>{state.jobs.length}</span>}</button>)}</nav>
      
      {connectionError && <div className="notice error-notice" role="alert">{connectionError} <button className="text-button" onClick={() => {void refresh();setDashboardRefresh(v=>v+1);}}>Tentar novamente</button></div>}
      {DEMO_MODE && <p className="notice">Dados fictícios. As ações são simuladas neste navegador.</p>}
      {!state && !connectionError && <LoadingNotice title="Carregando dados da plataforma…" description="Estamos reunindo os resultados e preparando a tela. Aguarde a conclusão do carregamento." />}
      {feedback && <div id="feedback" role="status" aria-live="polite">{feedback}</div>}

      {view==='overview' && <section className="panel dashboard" aria-labelledby="dashboard-title">
        <div className="section-title"><div><h2 id="dashboard-title">Resumo do mês</h2><p className="helper">Renovações concluídas no período selecionado.</p></div><div><label htmlFor="dashboard-month">Mês de conclusão</label><input id="dashboard-month" type="month" value={dashboardMonth} onInput={e => {setOverduePage(1);setDashboardMonth(e.currentTarget.value);}} required /></div><button className="secondary" onClick={()=>{void refresh();setDashboardRefresh(v=>v+1);}}>Atualizar</button></div>
        {dashboardError && <p role="alert" className="notice error-notice">{dashboardError}</p>}
        {!dashboard && !dashboardError && <LoadingNotice title="Reunindo informações do sistema de demonstração…" description="Estamos consultando os históricos e conferindo as pendências para exibir o resumo. O sistema de demonstração pode demorar para responder; os indicadores aparecerão após a conferência." simulated />}
        <div className="metrics" aria-label="Indicadores mensais">
          <Metric title="Empresas renovadas" value={dashboard?.companies} description="Cada empresa conta uma vez." />
          <Metric title="Empresas com aviso" value={dashboard?.warnings} description="Resultados que precisam de atenção." />
          <Metric title="Empresas atrasadas" value={dashboard?.overdue_count} description="Pendências anteriores ao mês atual." />
        </div>
        <div className="document-metrics">{kinds.map(k => <Metric key={k} title={`${k.toUpperCase()} renovados`} value={dashboard?.documents[k]} />)}</div>
        <p className="helper dashboard-footnote">Os indicadores refletem os exemplos fictícios e as renovações simuladas nesta página.</p>
        <details className="overdue-list" onToggle={e=>setOverdueOpen(e.currentTarget.open)}><summary>Ver estabelecimentos atrasados <span>{dashboard?.overdue.length ?? '—'}</span></summary>{overdueOpen && <><ul>{dashboard?.overdue.slice((overduePage-1)*PAGE_SIZE,overduePage*PAGE_SIZE).map(j => <li key={j.id}><div><strong>{j.name}</strong><span>Código {j.code}</span></div><span className="due-date">{dateLabel(j.validity)}</span></li>)}{dashboard && !dashboard.overdue.length && <li>Nenhum atraso encontrado.</li>}</ul><Pagination page={overduePage} total={dashboard?.overdue.length || 0} onChange={setOverduePage} /></>}</details>
        <div className="dashboard-next"><div><strong>Próxima renovação</strong><p>Escolha um mês e revise os estabelecimentos.</p></div><button className="primary" onClick={()=>setView('selection')}>Selecionar estabelecimentos →</button></div>
      </section>}

      {view==='selection' && <section className="panel" aria-labelledby="selection-title">
        <div className="section-title"><div><h2 id="selection-title">Renovar laudos</h2><p className="helper">1. Escolha o mês · 2. Revise a seleção · 3. Inicie</p></div></div>
        <form id="find-month" onSubmit={e => { e.preventDefault(); void search(); }}><div><label htmlFor="renewal-month">Mês de renovação</label><input id="renewal-month" type="month" required value={renewalMonth} disabled={!!busy || !!batch?.active} onInput={e => { searchVersion.current++; setRenewalMonth(e.currentTarget.value); setSearchResult(null); setChosen(new Set()); }} /></div><button type="submit" className="primary" disabled={!!busy || !!batch?.active || !!connectionError}>{busy === "search" ? "Conferindo no sistema de demonstração…" : "Buscar no sistema de demonstração"}</button></form>
        <p className="helper">Inclui pendências até o mês escolhido e atrasadas. Desmarque os estabelecimentos que não deseja renovar; cada documento mantém sua vigência.</p>
        {operationBusy === 'search' && <LoadingNotice title="Carregando dados do sistema de demonstração…" description="Estamos conferindo as vigências de LTCAT/PGR e PCMSO e reunindo as empresas do mês e as atrasadas. O sistema de demonstração pode demorar para responder. Aguarde; a lista será exibida quando a consulta terminar." simulated />}
        {searchResult && !DEMO_MODE && <p className="helper">PCMSOs cuja revisão já existe no sistema de demonstração foram retirados da seleção.</p>}
        {searchResult && <div className="selection-toolbar"><div className="candidate-search"><label htmlFor="candidate-search">Filtrar estabelecimentos</label><input id="candidate-search" type="search" value={candidateQuery} onInput={e=>setCandidateQuery(e.currentTarget.value)} placeholder="Nome ou código" /></div><div className="selection-tools"><strong>{chosen.size} de {searchResult.records.length} selecionados</strong><div><button className="text-button" disabled={!!busy || !!batch?.active} onClick={()=>setChosen(new Set(searchResult.records.map(selectionKey)))}>Selecionar todos</button><button className="text-button" disabled={!!busy || !!batch?.active || !chosen.size} onClick={()=>setChosen(new Set())}>Limpar seleção</button></div></div></div>}
        {searchResult && <div className="table-wrap"><table><thead><tr><th>Renovar</th><th>Estabelecimento</th><th>Código</th><th>Etapas necessárias</th></tr></thead><tbody id="candidates">{visibleCandidates.map(r => <tr key={selectionKey(r)}><td><input type="checkbox" aria-label={`Renovar ${r.name}`} checked={chosen.has(selectionKey(r))} onChange={() => toggle(r)} disabled={!!busy || !!batch?.active} /></td><td>{r.name}</td><td className="code">{r.code}</td><td>{r.ltcat_pgr_pending === undefined ? "Conferir LTCAT/PGR e PCMSO" : <>{r.ltcat_pgr_pending && <p>LTCAT/PGR · {dateLabel(r.ltcat_validity)}</p>}{r.pcmso_pending && <p>PCMSO · {dateLabel(r.pcmso_validity || null)}</p>}</>}</td></tr>)}</tbody></table></div>}
        {searchResult && <Pagination page={shownCandidatePage} total={candidates.length} onChange={setCandidatePage} />}
        {!searchResult && <p className="helper">Escolha o mês e clique em Buscar no sistema de demonstração.</p>}
        {!DEMO_MODE && state?.capabilities?.execution === false && <p className="notice compact-notice">Consulta disponível. A integração está preparada; as renovações reais aguardam habilitação no servidor após o teste autorizado.</p>}
        <div className="selection-footer"><span>{chosen.size} estabelecimento(s) serão incluídos no lote.</span><button className="primary start-button" disabled={!searchResult || !chosen.size || !!busy || !!batch?.active || !state?.execution_enabled || !!connectionError} onClick={() => void start()}>{batch?.active ? "Renovações em andamento" : busy === "start" ? "Iniciando…" : DEMO_MODE ? "Simular renovações" : "Iniciar renovações"}</button></div>
      </section>}

      {view==='results' && <section className="panel report" aria-labelledby="report-title">
        <div className="section-title"><div><h2 id="report-title">Resultados</h2><p className="helper">Consulte os resultados e exporte o relatório.</p></div><div className="report-actions"><span>{jobs.length} estabelecimento(s)</span><button className="secondary" disabled={!!busy || !state || !(state.jobs.some(completed)) || !!connectionError || state?.capabilities?.pdf === false} title={state?.capabilities?.pdf === false ? "Geração de PDF ainda não implementada no backend." : undefined} onClick={async () => { setBusy("pdf"); setFeedback(""); try { await downloadReport(reportMonth,status,deferredQuery); } catch (error) { setFeedback(errorMessage(error)); } finally { setBusy(null); } }}>{busy === "pdf" ? "Exportando…" : "Exportar PDF"}</button></div></div>
        <div className="result-summary"><span className="done">{finishedCount} Finalizado</span><span className="warning">{warningCount} Finalizado (com avisos)</span>{errorCount>0 && <span className="error">{errorCount} Erro</span>}</div>
        {!DEMO_MODE && batch?.active && batch.id && <button className="secondary" disabled={!!busy || !state?.execution_enabled} onClick={async()=>{setBusy('resume');try{await api('renewals/resume',{batch_id:batch.id});await refresh();setFeedback('Acompanhamento retomado. Etapas confirmadas não serão reenviadas.');}catch(error){setFeedback(errorMessage(error));}finally{setBusy(null);}}}>{busy==='resume'?'Retomando…':'Retomar acompanhamento'}</button>}
        <p className="helper batch-help">Dados fictícios da simulação. Recarregar a página restaura os exemplos. O PDF exportado não tem validade documental.</p>
        {(batch?.active || (!!batch?.total && batch?.message)) && <div className="batch-status" role="status" aria-live="polite">{batch.active ? `Processando ${batch.processed} de ${batch.total} empresa(s). ${batch.current_name ? `Agora: ${batch.current_name}.` : ""}` : `${batch.message} ${batch.completed} concluída(s), ${batch.attention} com avisos e ${batch.skipped} não executada(s).`}</div>}
        {!!state?.jobs.length && <div className="filters"><div><label htmlFor="search">Empresa ou código</label><input id="search" type="search" value={query} onInput={e => setQuery(e.currentTarget.value)} placeholder="Buscar no relatório" /></div><div><label htmlFor="month-filter">Mês de conclusão</label><input id="month-filter" type="month" value={reportMonth} onInput={e => setReportMonth(e.currentTarget.value)} /></div><div><label htmlFor="status-filter">Status dos documentos</label><select id="status-filter" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos os status</option>{["Pendente", "Em andamento", "Finalizado", "Finalizado (com avisos)", "Erro"].map(s => <option key={s}>{s}</option>)}</select></div><button className="text-button" onClick={() => { setQuery(""); setReportMonth(""); setStatus(""); }}>Limpar filtros</button></div>}
        {!!jobs.length && <div className="table-wrap"><table><thead><tr><th>Estabelecimento</th><th>Código</th><th>Vigência</th><th>LTCAT</th><th>PGR</th><th>PCMSO</th><th>Ações</th></tr></thead><tbody>{visibleJobs.map(j => <tr key={j.id}><td><strong>{j.name}</strong><p>{j.message}</p>{kinds.some(k => j[k] === "Em andamento") && <div className="progress"><span /></div>}</td><td className="code">{j.code}</td><td>{dateLabel(j.validity)}</td>{kinds.map(k => <td key={k}><span className={`badge ${statusClass(j[k])}`}>{j[k]}</span></td>)}<td><button className="secondary" onClick={() => void showDetails(j)}>Detalhes</button></td></tr>)}</tbody></table></div>}
        <Pagination page={shownResultPage} total={jobs.length} onChange={setResultPage} />
        {retryWarningsButton}
        {bulkRetry && <div className="notice" role="status"><p>{bulkRetry.processed} de {bulkRetry.total} empresas conferidas · {bulkRetry.accepted} tentativas preparadas · {bulkRetry.blocked.length} para conferência.</p>{!!bulkRetry.blocked.length && <details><summary>Ver empresas que continuam bloqueadas</summary>{bulkRetry.blocked.map((message,i)=><p key={i}>{message}</p>)}</details>}</div>}
        {state && !jobs.length && <div className="empty"><strong>{state.jobs.length ? 'Nenhum resultado para estes filtros' : 'Nenhuma renovação registrada'}</strong><p>{state.jobs.length ? 'Altere os filtros para consultar outros resultados.' : 'Os resultados aparecerão aqui após o processamento dos laudos.'}</p>{!state.jobs.length && <button className="secondary" onClick={()=>setView('selection')}>Selecionar estabelecimentos</button>}</div>}
      </section>}
      
      <footer>Demonstração de portfólio com dados fictícios.</footer>
    </main>

    <dialog ref={dialog} onCancel={closeDetails} aria-labelledby="detail-title">
      <div className="dialog-heading"><h2 id="detail-title">{details?.job.name || "Detalhes da renovação"}</h2><button className="secondary" onClick={closeDetails}>Fechar</button></div>
      {details && <><p>Código {details.job.code} · Vigência {dateLabel(details.job.validity)}</p><p>{details.job.message}</p>
        {details.loading && <LoadingNotice title="Conferindo informações no sistema de demonstração…" description="A API está verificando as vigências, os responsáveis e os pedidos anteriores, e aguardando a resposta do sistema de demonstração. O sistema de demonstração pode demorar para responder. O botão de tentar novamente ficará disponível após essa conferência, se as renovações estiverem habilitadas." simulated />}
        {details.error && <div className="notice" role="alert">{details.error}</div>}
        {details.plan && <><h3>Conferência atual</h3><ol>{details.plan.actions.map((a,i) => <li key={i}>{a}</li>)}</ol>{details.plan.blockers.length ? <div className="notice">{details.plan.blockers.map((b,i) => <p key={i}>{b}</p>)}</div> : <p>Nenhum impedimento identificado nesta consulta.</p>}</>}
        {!!details.job.warnings.length && <><h3>Avisos desta tentativa</h3>{details.job.warnings.map((w,i) => <p key={i}>{w}</p>)}</>}
        {details.job.manual_notes && <><h3>Anotações</h3><p>{details.job.manual_notes}</p></>}
        {details.job.validity_checks?.documents && <><h3>Conferência da vigência</h3>{kinds.slice(0,2).map(k => { const check=details.job.validity_checks?.documents?.[k]; return check && <p key={k}>{k.toUpperCase()}: {check.confirmed ? `data confirmada: ${dateLabel(check.requested)}` : check.message || `Data não confirmada. Encontrada: ${check.dates.map(dateLabel).join(", ") || "nenhum registro"}`}</p>; })}</>}
        {details.events && <><h3>Histórico de execução</h3>{!details.events.length && <p>Nenhuma execução registrada.</p>}{details.events.map((e,i) => <div key={i}><time>{new Date(e.at.includes("T") ? e.at : e.at.replace(" ","T")+"Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</time><p>{e.message}</p></div>)}</>}
        {!DEMO_MODE && details.job.completed_at && details.job.message==='Finalizado (com avisos)' && <div><p className="helper">A nova tentativa se aplica somente a {details.job.name}. Etapas confirmadas serão preservadas.</p><button className="primary" disabled={retrying!==null || operationBusy==='start' || operationBusy==='resume' || details.loading || !state?.execution_enabled} onClick={()=>void retry(details.job)}>{retrying===details.job.id?'Conferindo…':'Tentar novamente nesta empresa'}</button>{details.loading?<p role="status">Aguarde a conferência desta empresa.</p>:!state?.execution_enabled?<p className="helper">Renovações não habilitadas no servidor. Atualize a conexão para conferir.</p>:(operationBusy==='start' || operationBusy==='resume')?<p role="status">Aguarde a solicitação de renovação em andamento concluir.</p>:retrying!==null?<p role="status">Uma nova tentativa está sendo preparada.</p>:null}</div>}
        {retryWarningsButton}
      </>}
    </dialog>
  </>;
}

function Metric({ title, value, description }: { title: string; value?: number | null; description?: string }) {
  return <article><span>{title}</span><strong>{value ?? "—"}</strong>{description && <p className="helper">{description}</p>}</article>;
}

function LoadingNotice({title,description,simulated=false}:{title:string;description:string;simulated?:boolean}) {
  const [waiting,setWaiting]=useState(false);
  useEffect(()=>{const timer=setTimeout(()=>setWaiting(true),15000);return()=>clearTimeout(timer);},[]);
  return <div className="notice" role="status" aria-live="polite"><strong>{waiting && simulated?'Aguardando resposta do sistema de demonstração…':title}</strong><p>{description}</p><div className="progress" aria-hidden="true"><span /></div></div>;
}

function Pagination({page,total,onChange}:{page:number;total:number;onChange:(page:number)=>void}) {
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  if(!total) return null;
  return <div className="pagination"><span>{(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE,total)} de {total}</span>{pages>1 && <div><button className="secondary" aria-label="Página anterior" disabled={page<=1} onClick={()=>onChange(page-1)}>← Anterior</button><span>Página {page} de {pages}</span><button className="secondary" aria-label="Próxima página" disabled={page>=pages} onClick={()=>onChange(page+1)}>Próxima →</button></div>}</div>;
}
