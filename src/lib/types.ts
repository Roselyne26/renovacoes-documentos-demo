export type Kind = "ltcat" | "pgr" | "pcmso";
export const kinds: Kind[] = ["ltcat", "pgr", "pcmso"];
export type Status = "Pendente" | "Em andamento" | "Finalizado" | "Finalizado (com avisos)" | "Erro";
export interface ValidityCheck { confirmed: boolean; requested: string; dates: string[]; message?: string }
export interface Job {
  completed_at?: string;
  renewed_documents?: Kind[];
  document_validities?: Partial<Record<Kind,string>>;
  id: number; code: string; name: string; validity: string; message: string;
  ltcat: Status; pgr: Status; pcmso: Status; warnings: string[]; manual_notes: string;
  legacy_candidate: boolean; legacy_confirmed: boolean;
  validity_checks?: { checked_at?: string; documents?: Partial<Record<Kind, ValidityCheck>> };
}
export interface State {
  mode: "demo" | "connected"; jobs: Job[]; execution_enabled: boolean; bulk_enabled: boolean;
  capabilities?: { execution: boolean; results: boolean; pdf: boolean; retention: boolean };
  integration?: { catalog_available: boolean; synchronized_at: string | null };
  batch: { id?:string; errors?:number; active: boolean; processed: number; total: number; current_name: string; message: string; completed: number; attention: number; skipped: number };
}
export interface Candidate { selection_key?: string; code: string; name: string; ltcat_validity: string | null; ltcat_pgr_pending?: boolean; pcmso_pending?: boolean; pcmso_validity?: string | null }
export interface SearchResult { records: Candidate[]; search_token: string; month: string; demo: boolean; synchronized_at?: string; catalog_generation?: string; execution_available?: boolean }
export interface Dashboard {
  month: string; companies: number | null; served: number | null; warnings: number | null; overdue_count: number;
  documents: Record<Kind, number | null>; overdue: Pick<Job, "id" | "name" | "code" | "validity">[]; untracked: number; metrics_available?: boolean;
}
export interface Plan { actions: string[]; blockers: string[] }
export interface History { events: { at: string; message: string }[] }
