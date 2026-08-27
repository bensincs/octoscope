"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ListUnorderedIcon,
  GitPullRequestIcon,
} from "@primer/octicons-react";
import ConfigEditor from "@/components/ConfigEditor";
import { useToast } from "@/components/Toast";
import { RULES } from "@/lib/hierarchy";
import { prRules } from "@/lib/pullRequests";
import { Panel } from "./primitives";

const PR_RULE_FIELDS = [
  {
    key: "flagFailingChecks",
    label: "Failing checks",
    blurb: "CI checks that have failed or errored.",
  },
  {
    key: "flagMergeConflicts",
    label: "Merge conflicts",
    blurb: "Conflicts with the base branch.",
  },
  {
    key: "flagBehindBase",
    label: "Behind base branch",
    blurb: "Needs an update or rebase before merging.",
  },
];

function Section({ icon, title, subtitle, action, children }) {
  return (
    <section className="rounded-md border border-border">
      <div className="flex items-center gap-2.5 border-b border-border bg-subtle/40 px-3 py-2.5">
        <span className="text-muted">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Toggle({ checked, disabled, onChange, label, blurb, severity }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5 hover:bg-subtle/50">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-fg">{label}</span>
          {severity && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                severity === "error"
                  ? "bg-danger/15 text-danger"
                  : "bg-attention/15 text-attention"
              }`}
            >
              {severity}
            </span>
          )}
        </span>
        {blurb && <span className="mt-0.5 block text-xs text-muted">{blurb}</span>}
      </span>
    </label>
  );
}

export default function RulebookPanel({ project, patch, canEdit }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState(null);

  // Everything here is edited locally and committed by ONE Save at the bottom.
  // The hierarchy editor runs embedded (hideFooter) and streams its value out
  // via onChange, so it no longer strands a second save button mid-page.
  const [draftConfig, setDraftConfig] = useState(project.config);
  const [includeClosed, setIncludeClosed] = useState(!!project.includeClosedIssues);

  useEffect(() => setDraftConfig(project.config), [project.config]);
  useEffect(
    () => setIncludeClosed(!!project.includeClosedIssues),
    [project.includeClosedIssues]
  );

  const disabled = useMemo(
    () => new Set(draftConfig?.disabledRules ?? []),
    [draftConfig]
  );
  const pr = prRules(draftConfig);

  const grouped = useMemo(
    () =>
      RULES.reduce((acc, r) => {
        (acc[r.group] ??= []).push(r);
        return acc;
      }, {}),
    []
  );

  const dirty =
    JSON.stringify(draftConfig) !== JSON.stringify(project.config) ||
    includeClosed !== !!project.includeClosedIssues;

  const enabledCount = RULES.length - disabled.size;

  function setRuleEnabled(id, enabled) {
    setDraftConfig((c) => {
      const next = new Set(c?.disabledRules ?? []);
      enabled ? next.delete(id) : next.add(id);
      return { ...c, disabledRules: [...next] };
    });
  }

  function setAllRules(enabled) {
    setDraftConfig((c) => ({
      ...c,
      disabledRules: enabled ? [] : RULES.map((r) => r.id),
    }));
  }

  function setPrRule(key, value) {
    setDraftConfig((c) => ({
      ...c,
      pullRequests: { ...prRules(c), [key]: value },
    }));
  }

  return (
    <Panel
      title="Rulebook"
      blurb="What this project enforces on issues and pull requests."
    >
      <fieldset disabled={!canEdit} className="space-y-5">
        <Section
          icon={<ListUnorderedIcon size={16} />}
          title="Issues"
          subtitle={`Hierarchy, scope and ${enabledCount} of ${RULES.length} checks enabled`}
          action={
            canEdit && (
              <div className="flex shrink-0 gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setAllRules(true)}
                  className="text-accent hover:underline"
                >
                  All on
                </button>
                <span className="text-muted">·</span>
                <button
                  type="button"
                  onClick={() => setAllRules(false)}
                  className="text-accent hover:underline"
                >
                  All off
                </button>
              </div>
            )
          }
        >
          <div className="border-b border-border px-3 py-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Hierarchy &amp; labels
            </p>
            <ConfigEditor
              config={project.config}
              onChange={(next) =>
                setDraftConfig((c) => ({
                  ...next,
                  // Preserve settings the hierarchy editor knows nothing about.
                  disabledRules: c?.disabledRules ?? [],
                  pullRequests: prRules(c),
                }))
              }
              errors={errors}
              hideFooter
            />
          </div>

          <div className="border-b border-border">
            <p className="px-3 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Scope
            </p>
            <Toggle
              checked={includeClosed}
              onChange={setIncludeClosed}
              label="Include closed issues"
              blurb="Applies the next time someone refreshes the Issues tab."
            />
          </div>

          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="border-b border-border last:border-b-0">
              <p className="px-3 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {group}
              </p>
              <div className="divide-y divide-border">
                {items.map((r) => (
                  <Toggle
                    key={r.id}
                    checked={!disabled.has(r.id)}
                    onChange={(v) => setRuleEnabled(r.id, v)}
                    label={r.title}
                    severity={r.severity}
                    blurb={r.desc}
                  />
                ))}
              </div>
            </div>
          ))}
        </Section>

        <Section
          icon={<GitPullRequestIcon size={16} />}
          title="Pull requests"
          subtitle="States that block or degrade a merge. Applied instantly — no refresh needed."
        >
          <div className="divide-y divide-border">
            {PR_RULE_FIELDS.map((f) => (
              <Toggle
                key={f.key}
                checked={!!pr[f.key]}
                onChange={(v) => setPrRule(f.key, v)}
                label={f.label}
                blurb={f.blurb}
              />
            ))}
          </div>
        </Section>

        {errors?.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-danger">
            {errors.map((e, i) => (
              <li key={i}>{e.message || String(e)}</li>
            ))}
          </ul>
        )}

        {canEdit && (
          <div className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-canvas py-3">
            <button
              onClick={async () => {
                setSaving(true);
                setErrors(null);
                try {
                  await patch({
                    config: draftConfig,
                    includeClosedIssues: includeClosed,
                  });
                  toast.success("Rulebook saved.");
                } catch (e) {
                  if (e.fields) setErrors(e.fields);
                  toast.error(e.message);
                } finally {
                  setSaving(false);
                }
              }}
              disabled={!dirty || saving}
              className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save rulebook"}
            </button>
            {dirty && <span className="text-xs text-muted">Unsaved changes</span>}
          </div>
        )}
      </fieldset>
    </Panel>
  );
}
