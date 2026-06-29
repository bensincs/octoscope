"use client";
import { useEffect, useState } from "react";
import { XIcon } from "@primer/octicons-react";
import TagInput from "@/components/TagInput";

// Convert a stored config into editable form state.
function toForm(config) {
  const levels = Array.isArray(config?.levels) ? config.levels : [];
  return {
    // Each level is an array of type-name strings.
    levels: levels.length
      ? levels.map((lvl) => (Array.isArray(lvl) ? [...lvl] : [String(lvl)]))
      : [["Epic"], ["Feature"], ["User Story"], ["Task", "Bug"]],
    // Aliases aren't edited here — preserve whatever the project already has.
    aliases: config?.aliases && typeof config.aliases === "object" ? config.aliases : {},
    allowedLabels: Array.isArray(config?.allowedLabels) ? [...config.allowedLabels] : [],
  };
}

// Build a raw config object from the form to send to the API (server validates).
function fromForm(form) {
  const levels = form.levels
    .map((lvl) => lvl.map((t) => t.trim()).filter(Boolean))
    .filter((arr) => arr.length > 0);

  const allowedLabels = form.allowedLabels.map((s) => s.trim()).filter(Boolean);

  return {
    levels,
    aliases: form.aliases || {},
    allowedLabels,
    // Enforcement is always on whenever labels are configured; with no labels
    // it's a no-op (and validation forbids enforce-with-empty).
    enforceLabels: allowedLabels.length > 0,
  };
}

function fieldError(errors, field) {
  return errors?.find((e) => e.field === field)?.message || null;
}

export default function ConfigEditor({
  config,
  onSave,
  saving,
  errors,
  // Embedded mode (used by the wizard / settings): stream the live config out
  // via onChange and hide the built-in "Save rulebook" footer button.
  onChange,
  hideFooter = false,
}) {
  const [form, setForm] = useState(() => toForm(config));

  // Re-seed when the underlying project config changes (e.g. after save).
  useEffect(() => {
    setForm(toForm(config));
  }, [config]);

  // In embedded mode, publish the normalized config whenever the form changes.
  useEffect(() => {
    if (onChange) onChange(fromForm(form));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const setLevel = (i, tags) =>
    setForm((f) => {
      const levels = [...f.levels];
      levels[i] = tags;
      return { ...f, levels };
    });
  const addLevel = () => setForm((f) => ({ ...f, levels: [...f.levels, []] }));
  const removeLevel = (i) =>
    setForm((f) => ({ ...f, levels: f.levels.filter((_, idx) => idx !== i) }));

  const levelsError = fieldError(errors, "levels");
  const labelsError = fieldError(errors, "allowedLabels");

  return (
    <div className="space-y-4">
      {/* Hierarchy levels */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-semibold text-muted">
            Hierarchy (top → bottom)
          </label>
          <button
            type="button"
            onClick={addLevel}
            className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:bg-subtle hover:text-fg"
          >
            + Add level
          </button>
        </div>
        <div className="space-y-1.5">
          {form.levels.map((tags, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-2 w-5 text-right text-[11px] text-muted">{i + 1}</span>
              <div className="flex-1">
                <TagInput
                  tags={tags}
                  onChange={(next) => setLevel(i, next)}
                  placeholder="Add an issue type…"
                  ariaLabel={`Level ${i + 1} issue types`}
                />
              </div>
              <button
                type="button"
                onClick={() => removeLevel(i)}
                disabled={form.levels.length <= 1}
                className="mt-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-subtle disabled:opacity-40"
                aria-label="Remove level"
              >
                <XIcon size={14} />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted">
          Each level holds the issue types allowed at that depth. Add several
          types to one level (e.g. <code>Task</code> and <code>Bug</code>) to make
          them siblings.
        </p>
        {levelsError && <p className="mt-1 text-[11px] text-danger">{levelsError}</p>}
      </div>

      {/* Allowed labels */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-muted">
          Allowed labels
        </label>
        <TagInput
          tags={form.allowedLabels}
          onChange={(next) => setForm((f) => ({ ...f, allowedLabels: next }))}
          placeholder="Add a label…"
          ariaLabel="Allowed labels"
        />
        <p className="mt-1 text-[11px] text-muted">
          Issues carrying any label outside this list are flagged. Leave empty to
          allow all labels.
        </p>
        {labelsError && <p className="mt-1 text-[11px] text-danger">{labelsError}</p>}
      </div>

      <div className="flex justify-end">
        {!hideFooter && (
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave(fromForm(form))}
            className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save rulebook"}
          </button>
        )}
      </div>
    </div>
  );
}
