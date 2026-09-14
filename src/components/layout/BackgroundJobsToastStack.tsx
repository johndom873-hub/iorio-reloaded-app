import { useEffect } from "react";
import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import { Spinner } from "../Spinner";
import { useBackgroundJobs, type BackgroundJob } from "../../contexts/BackgroundJobsContext";

const autoDismissAfterMs = 15_000;

// Mounted once in AppLayout, which stays mounted across every route change
// (React Router only swaps the <Outlet/> content) — so a scan or order kicked
// off from one page keeps its toast visible while the user navigates
// elsewhere, instead of dying with the page that started it.
export function BackgroundJobsToastStack() {
  const { jobs, dismissJob } = useBackgroundJobs();
  const visibleJobs = jobs.filter((job) => !job.dismissed);

  if (visibleJobs.length === 0) return null;

  return (
    <div className="toast-container position-fixed bottom-0 end-0 p-3" style={{ zIndex: 1080 }}>
      {visibleJobs.map((job) => (
        <BackgroundJobToast key={job.id} job={job} onDismiss={() => dismissJob(job.id)} />
      ))}
    </div>
  );
}

function BackgroundJobToast({ job, onDismiss }: { job: BackgroundJob; onDismiss: () => void }) {
  // Only a terminal status auto-vanishes — a "running" job isn't done yet,
  // so it stays until it reaches done/error (or the user closes it).
  useEffect(() => {
    if (job.status === "running") return;
    const timer = setTimeout(onDismiss, autoDismissAfterMs);
    return () => clearTimeout(timer);
  }, [job.status, job.message, onDismiss]);

  return (
    <div className="toast show mb-2" role="status" aria-live="polite">
      <div className="toast-header">
        {job.status === "running" && <Spinner size="sm" className="me-2" />}
        {job.status === "done" && <IconCircleCheck size={18} className="text-success me-2" />}
        {job.status === "error" && <IconAlertTriangle size={18} className="text-danger me-2" />}
        <strong className="me-auto">{job.label}</strong>
        <button type="button" className="btn-close" aria-label="Close" onClick={onDismiss} />
      </div>
      <div className="toast-body">{job.message}</div>
    </div>
  );
}
