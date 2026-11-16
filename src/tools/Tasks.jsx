import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
import {
  SUB_MAX,
  TITLE_MAX,
  addSub,
  addTask,
  removeSub,
  removeTask,
  renameSub,
  renameTask,
  restoreTask,
  splitTasks,
  toggleSub,
  toggleTask,
  useTasks,
} from "../lib/tasks.js";
import { useToday } from "../lib/today.js";
import "./Tasks.css";

// The same nine seconds every other tool gives back a deletion in.
const UNDO_MS = 9000;

const doneLabel = (doneAt, today) => {
  if (doneAt >= today) return "Done today";
  return `Done ${new Date(doneAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
};

/**
 * Tasks — one-off things to get done, each with optional smaller items under
 * it. The plainest tool in Orbit on purpose: check it when it's done, and it
 * moves out of the way.
 */
export default function Tasks() {
  const tasks = useTasks();
  const today = useToday();

  const [editing, setEditing] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [undo, setUndo] = useState(null);
  const undoTimer = useRef(null);

  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const { open, done } = splitTasks(tasks.items);

  const handleDelete = (task) => {
    clearTimeout(undoTimer.current);
    setUndo({ task, index: tasks.items.findIndex((t) => t.id === task.id) });
    removeTask(task.id);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };

  const handleUndo = () => {
    clearTimeout(undoTimer.current);
    if (undo) restoreTask(undo.task, undo.index);
    setUndo(null);
  };

  const row = (task) => (
    <TaskRow
      key={task.id}
      task={task}
      today={today}
      editing={editing === task.id}
      onEdit={() => setEditing(task.id)}
      onEditDone={() => setEditing(null)}
      onDelete={() => handleDelete(task)}
    />
  );

  return (
    <div className="tasks">
      <div className="tasks-column">
        <Composer />

        {tasks.items.length === 0 ? (
          <div className="tasks-empty">
            <h2 className="tasks-empty-title">Nothing on the list.</h2>
            <p className="tasks-empty-body">
              For the one-off things &mdash; groceries, the dishes, a form to post. Add the
              smaller bits under a task if it helps, and tick it off when it&rsquo;s done.
            </p>
          </div>
        ) : (
          <>
            <section className="task-section">
              {open.length === 0 ? (
                <p className="task-section-note">Everything&rsquo;s done.</p>
              ) : (
                <ul className="task-list">{open.map(row)}</ul>
              )}
            </section>

            {done.length > 0 && (
              <section className="task-section">
                <button
                  type="button"
                  className="task-done-toggle"
                  aria-expanded={showDone}
                  onClick={() => setShowDone((v) => !v)}
                >
                  {showDone ? (
                    <ChevronDown size={16} aria-hidden="true" />
                  ) : (
                    <ChevronRight size={16} aria-hidden="true" />
                  )}
                  Completed
                  <span className="task-done-count">{done.length}</span>
                </button>
                {showDone && <ul className="task-list task-list--done">{done.map(row)}</ul>}
              </section>
            )}
          </>
        )}

        {undo && (
          <div className="undo" role="status">
            <span className="undo-text">Deleted &ldquo;{undo.task.title}&rdquo;</span>
            <button type="button" className="text-button" onClick={handleUndo}>
              Undo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Composer() {
  const [title, setTitle] = useState("");
  const canAdd = title.trim().length > 0;

  const submit = (event) => {
    event.preventDefault();
    if (!canAdd) return;
    addTask(title);
    setTitle("");
  };

  return (
    <form className="composer-form" onSubmit={submit}>
      <div className="composer">
        <div className="composer-field">
          <label className="field-label" htmlFor="task-title">
            New task
          </label>
          <input
            id="task-title"
            className="field-input"
            type="text"
            autoComplete="off"
            maxLength={TITLE_MAX}
            placeholder="What needs doing?"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <button type="submit" className="button button--primary composer-add" disabled={!canAdd}>
          <Plus size={18} aria-hidden="true" />
          Add
        </button>
      </div>
    </form>
  );
}

function TaskRow({ task, today, editing, onEdit, onEditDone, onDelete }) {
  const [adding, setAdding] = useState(false);
  const finished = task.doneAt !== null;
  const ticked = task.subs.filter((s) => s.done).length;

  let meta = null;
  if (finished) meta = doneLabel(task.doneAt, today);
  else if (task.subs.length > 0) meta = `${ticked} of ${task.subs.length} items`;

  return (
    <li className="task" data-done={String(finished)}>
      <div className="task-head">
        {/* Checked by hand, independently of the items under it. */}
        <button
          type="button"
          className="task-check"
          role="checkbox"
          aria-checked={finished}
          aria-label={finished ? `Reopen ${task.title}` : `Mark ${task.title} done`}
          onClick={() => toggleTask(task.id)}
        >
          {finished && <Check size={13} aria-hidden="true" />}
        </button>

        <div className="task-body">
          {editing ? (
            <TitleEditor task={task} onDone={onEditDone} />
          ) : (
            <button
              type="button"
              className="task-title"
              onClick={onEdit}
              aria-label={`Rename ${task.title}`}
            >
              {task.title}
            </button>
          )}
          {meta && <p className="task-meta">{meta}</p>}
        </div>

        <div className="task-actions">
          <button
            type="button"
            className="icon-button icon-button--small icon-button--danger"
            onClick={onDelete}
            aria-label={`Delete ${task.title}`}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* A finished task keeps its items out of sight: it's done, and the
          detail of how is no longer the point. */}
      {!finished && (
        <>
          {task.subs.length > 0 && (
            <ul className="sub-list">
              {task.subs.map((sub) => (
                <SubRow key={sub.id} taskId={task.id} sub={sub} />
              ))}
            </ul>
          )}

          {adding ? (
            <SubComposer taskId={task.id} onDone={() => setAdding(false)} />
          ) : (
            <div className="sub-add">
              <button type="button" className="text-button" onClick={() => setAdding(true)}>
                <Plus size={14} aria-hidden="true" />
                Add item
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

function TitleEditor({ task, onDone }) {
  const [title, setTitle] = useState(task.title);
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const save = (event) => {
    event.preventDefault();
    if (!title.trim()) return;
    renameTask(task.id, title);
    onDone();
  };

  return (
    <form className="task-rename" onSubmit={save}>
      <input
        ref={ref}
        className="field-input task-rename-input"
        type="text"
        autoComplete="off"
        maxLength={TITLE_MAX}
        aria-label="Task"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onDone();
          }
        }}
      />
      <button type="submit" className="text-button" disabled={!title.trim()}>
        Save
      </button>
      <button type="button" className="text-button" onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}

function SubRow({ taskId, sub }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(sub.text);
  // Escape unmounts the input, and some browsers blur it on the way out. The
  // blur must not then save the edit Escape was meant to throw away.
  const cancelled = useRef(false);

  const commit = () => {
    if (cancelled.current) return;
    renameSub(taskId, sub.id, text);
    setEditing(false);
  };

  return (
    <li className="sub" data-done={String(sub.done)}>
      <button
        type="button"
        className="sub-check"
        role="checkbox"
        aria-checked={sub.done}
        aria-label={sub.done ? `Uncheck ${sub.text}` : `Check ${sub.text}`}
        onClick={() => toggleSub(taskId, sub.id)}
      >
        {sub.done && <Check size={11} aria-hidden="true" />}
      </button>

      {editing ? (
        <input
          className="sub-input"
          type="text"
          autoComplete="off"
          maxLength={SUB_MAX}
          aria-label="Item"
          value={text}
          // Focus lands where the click asked for it.
          autoFocus
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelled.current = true;
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="sub-text"
          onClick={() => {
            cancelled.current = false;
            setText(sub.text);
            setEditing(true);
          }}
          aria-label={`Rename ${sub.text}`}
        >
          {sub.text}
        </button>
      )}

      <button
        type="button"
        className="icon-button icon-button--small sub-remove"
        onClick={() => removeSub(taskId, sub.id)}
        aria-label={`Remove ${sub.text}`}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * Stays open after each Enter, so a list goes in the way you'd say it —
 * lettuce, tomato, bread — without reaching for the mouse between items.
 */
function SubComposer({ taskId, onDone }) {
  const [text, setText] = useState("");
  const ref = useRef(null);
  const cancelled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="sub-add sub-add--open">
      <input
        ref={ref}
        className="sub-input"
        type="text"
        autoComplete="off"
        maxLength={SUB_MAX}
        placeholder="Add an item, then Enter"
        aria-label="New item"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (cancelled.current) return;
          if (text.trim()) addSub(taskId, text);
          onDone();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (text.trim()) {
              addSub(taskId, text);
              setText("");
            } else {
              onDone();
            }
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            onDone();
          }
        }}
      />
    </div>
  );
}
