import { apiRequest } from "./client";

export type JobRunStatus = "running" | "success" | "failure";

export interface JobRun {
  id: string;
  jobName: string;
  startedAt: string;
  finishedAt: string | null;
  status: JobRunStatus;
  errorMessage: string | null;
  details: Record<string, unknown> | null;
}

export function fetchJobRuns(limit = 50): Promise<JobRun[]> {
  return apiRequest<JobRun[]>(`/system-health/jobs?limit=${limit}`);
}

export function fetchJobStatuses(): Promise<JobRun[]> {
  return apiRequest<JobRun[]>("/system-health/status");
}

export function triggerIbkrHealthCheck(): Promise<JobRun | null> {
  return apiRequest<JobRun | null>("/system-health/check-ibkr", { method: "POST" });
}
