import { useEffect, useState } from "react";
import { addCaseTask, completeCaseTask } from "../lib/caseService";
import type { CaseTaskPriority } from "../lib/caseService";
import { supabase } from "../lib/supabase";

type CaseTask = {
  id: string;
  title: string;
  description: string | null;
  task_type: string;
  priority: CaseTaskPriority;
  status: "open" | "completed" | "cancelled";
  source: "manual" | "automated";
  due_at: string | null;
  created_at: string;
  completed_at: string | null;
};

export function CaseTasks({
  caseId,
  onNotice,
}: {
  caseId: string;
  onNotice: (message: string) => void;
}) {
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    priority: "normal" as CaseTaskPriority,
    dueAt: "",
  });

  async function load() {
    if (!supabase) return;

    const { data, error: loadError } = await supabase
      .from("case_tasks")
      .select(
        "id, title, description, task_type, priority, status, source, due_at, created_at, completed_at",
      )
      .eq("case_id", caseId)
      .order("status")
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (loadError) {
      setError(loadError.message);
      return;
    }

    setTasks((data ?? []) as CaseTask[]);
    setError("");
  }

  useEffect(() => {
    void load();

    if (!supabase) return;
    const channel = supabase
      .channel(`case-tasks-${caseId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "case_tasks",
          filter: `case_id=eq.${caseId}`,
        },
        () => void load(),
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [caseId]);

  async function addTask() {
    if (!draft.title.trim()) return;

    setSaving(true);
    try {
      await addCaseTask({
        caseId,
        title: draft.title,
        description: draft.description,
        priority: draft.priority,
        dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
      });
      setDraft({
        title: "",
        description: "",
        priority: "normal",
        dueAt: "",
      });
      setShowForm(false);
      onNotice("Case task added.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task could not be added.");
    } finally {
      setSaving(false);
    }
  }

  async function completeTask(task: CaseTask) {
    setSaving(true);
    try {
      await completeCaseTask(task.id);
      onNotice(`Task completed: ${task.title}`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task could not be completed.");
    } finally {
      setSaving(false);
    }
  }

  const visible = tasks.filter((task) =>
    showCompleted ? task.status !== "cancelled" : task.status === "open",
  );

  return (
    <div className="case-tasks-panel">
      <div className="case-toolbar">
        <div>
          <strong>Case tasks</strong>
          <small>
            Automated tasks surface missing follow-ups; manual tasks can track other actions.
          </small>
        </div>
        <div>
          <button
            type="button"
            className="classic-button"
            onClick={() => setShowCompleted((current) => !current)}
          >
            {showCompleted ? "Open only" : "Show history"}
          </button>
          <button
            type="button"
            className="classic-button primary"
            onClick={() => setShowForm((current) => !current)}
          >
            {showForm ? "Cancel" : "+ Task"}
          </button>
        </div>
      </div>

      {error && <p className="send-error">{error}</p>}

      {showForm && (
        <div className="case-task-form">
          <label>
            Task
            <input
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="e.g. Call patient about crown approval"
            />
          </label>
          <label>
            Priority
            <select
              value={draft.priority}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  priority: event.target.value as CaseTaskPriority,
                }))
              }
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label>
            Due
            <input
              type="datetime-local"
              value={draft.dueAt}
              onChange={(event) =>
                setDraft((current) => ({ ...current, dueAt: event.target.value }))
              }
            />
          </label>
          <label className="case-task-description">
            Description
            <textarea
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </label>
          <div className="dialog-actions">
            <button
              type="button"
              className="classic-button primary"
              disabled={saving || !draft.title.trim()}
              onClick={() => void addTask()}
            >
              Add Task
            </button>
          </div>
        </div>
      )}

      <div className="case-task-list">
        {visible.map((task) => {
          const overdue =
            task.status === "open" &&
            task.due_at &&
            new Date(task.due_at).getTime() < Date.now();

          return (
            <article
              key={task.id}
              className={`case-task-card task-${task.priority} ${overdue ? "overdue" : ""}`}
            >
              <div className="task-check">
                {task.status === "open" ? (
                  <button
                    type="button"
                    aria-label="Complete task"
                    disabled={saving}
                    onClick={() => void completeTask(task)}
                  >
                    ○
                  </button>
                ) : (
                  <span>✓</span>
                )}
              </div>
              <div>
                <div className="task-heading">
                  <strong>{task.title}</strong>
                  <span className={`case-priority priority-${task.priority}`}>
                    {task.priority}
                  </span>
                </div>
                {task.description && <p>{task.description}</p>}
                <small>
                  {task.source === "automated" ? "Automated" : "Manual"}
                  {task.due_at
                    ? ` · Due ${new Date(task.due_at).toLocaleString()}`
                    : ""}
                  {overdue ? " · OVERDUE" : ""}
                </small>
              </div>
            </article>
          );
        })}

        {!visible.length && (
          <div className="empty-state">
            {showCompleted ? "No task history yet." : "No open tasks. Nothing is currently blocked."}
          </div>
        )}
      </div>
    </div>
  );
}
