"use client";
import { useRouter } from "next/navigation";
import {
  PencilIcon,
  CheckIcon,
  XIcon,
  ListUnorderedIcon,
  GitPullRequestIcon,
} from "@primer/octicons-react";
import { useProjectContext } from "@/components/ProjectContext";
import { compileConfig, RULES } from "@/lib/hierarchy";
import { prRules, PR_FLAG_LABELS, PR_FLAGS } from "@/lib/pullRequests";
import { meetsRole } from "@/lib/access";

// Read-only reference for the project's rulebook.
//
// Deliberately NOT the rule filter on the Issues tab — that one is tied to a
// specific set of results and shows violation counts. This shows what is
// configured, whether or not anything has been scanned.

function Card({ icon, title, subtitle, count, children }) {
  return (
    <section className="gh-card overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="text-muted">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {count && (
          <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-muted">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Block({ label, children }) {
  return (
    <div className="border-b border-border px-4 py-3 last:border-b-0">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

function RuleRow({ on, title, severity, desc }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className={on ? "mt-0.5 text-success" : "mt-0.5 text-muted/50"}>
        {on ? <CheckIcon size={16} /> : <XIcon size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`text-sm ${on ? "text-fg" : "text-muted"}`}>{title}</span>
          {severity && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                severity === "error"
                  ? "bg-danger/15 text-danger"
                  : "bg-attention/15 text-attention"
              } ${on ? "" : "opacity-50"}`}
            >
              {severity}
            </span>
          )}
          {!on && (
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted">
              off
            </span>
          )}
        </span>
        {desc && <span className="mt-0.5 block text-xs text-muted">{desc}</span>}
      </span>
    </li>
  );
}

export default function ProjectRulebookPage() {
  const router = useRouter();
  const { project, projectId } = useProjectContext();

  if (!project) return null;

  const config = project.config ?? {};
  const compiled = compileConfig(config);
  const levels = config.levels ?? [];
  const pr = prRules(config);
  const disabled = new Set(config.disabledRules ?? []);
  const canEdit = meetsRole(project.viewerRole || "owner", "editor");

  const hasRepos = (project.repos?.length ?? 0) > 0;
  const issueRulesOn = RULES.filter((r) => !disabled.has(r.id)).length;
  const prRulesOn = Object.values(pr).filter(Boolean).length;

  // All issue rules in one place, grouped only as subheadings so they read as a
  // single list rather than several disconnected cards.
  const grouped = RULES.reduce((acc, r) => {
    (acc[r.group] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-normal text-fg">Rulebook</h1>
          <p className="mt-1 text-sm text-muted">
            What this project enforces on issues and pull requests.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() =>
              router.push(`/projects/${projectId}/settings?section=rulebook`)
            }
            className="btn inline-flex shrink-0 items-center gap-2 px-3 py-1.5 text-sm"
          >
            <PencilIcon size={16} />
            Edit
          </button>
        )}
      </div>

      {!hasRepos && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent/40 bg-accent/10 px-4 py-3">
          <p className="text-sm text-fg">
            No repositories are connected yet, so there's nothing to scan. The
            Issues and Pull requests tabs appear once you add one.
          </p>
          {canEdit && (
            <button
              onClick={() =>
                router.push(`/projects/${projectId}/settings?section=repos`)
              }
              className="btn-primary shrink-0 px-3 py-1.5 text-sm"
            >
              Connect a repository
            </button>
          )}
        </div>
      )}

      <Card
        icon={<ListUnorderedIcon size={16} />}
        title="Issues"
        subtitle="Hierarchy, scope and the checks applied to every issue"
        count={`${issueRulesOn}/${RULES.length} rules on`}
      >
        <Block label="Hierarchy">
          {levels.length === 0 ? (
            <p className="text-sm text-muted">No hierarchy configured.</p>
          ) : (
            <ol className="space-y-1.5">
              {levels.map((types, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-[11px] uppercase tracking-wide text-muted">
                    L{i + 1}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {types.map((t) => (
                      <span
                        key={t}
                        className="rounded-full border px-2 py-0.5 text-xs text-fg"
                        style={{
                          borderColor:
                            compiled?.typeMetaOf?.(t)?.accent || "var(--border)",
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Block>

        <Block label="Scope">
          <ul>
            <RuleRow
              on={!!project.includeClosedIssues}
              title={
                project.includeClosedIssues
                  ? "Closed issues are included in scans"
                  : "Only open issues are scanned"
              }
            />
            <RuleRow
              on={!!config.enforceLabels}
              title={
                config.enforceLabels
                  ? "Only approved labels are allowed"
                  : "Labels are not enforced"
              }
              desc={
                config.enforceLabels
                  ? (config.allowedLabels ?? []).join(", ") || "(none configured)"
                  : undefined
              }
            />
          </ul>
        </Block>

        {Object.entries(grouped).map(([group, items]) => (
          <Block key={group} label={group}>
            <ul>
              {items.map((r) => (
                <RuleRow
                  key={r.id}
                  on={!disabled.has(r.id)}
                  title={r.title}
                  severity={r.severity}
                  desc={r.desc}
                />
              ))}
            </ul>
          </Block>
        ))}
      </Card>

      <Card
        icon={<GitPullRequestIcon size={16} />}
        title="Pull requests"
        subtitle="States that block or degrade a merge"
        count={`${prRulesOn}/3 rules on`}
      >
        <Block label="Checks">
          <ul>
            <RuleRow
              on={pr.flagFailingChecks}
              title={PR_FLAG_LABELS[PR_FLAGS.FAILING_CHECKS]}
              desc="CI checks that have failed or errored."
            />
            <RuleRow
              on={pr.flagMergeConflicts}
              title={PR_FLAG_LABELS[PR_FLAGS.MERGE_CONFLICT]}
              desc="Conflicts with the base branch."
            />
            <RuleRow
              on={pr.flagBehindBase}
              title={PR_FLAG_LABELS[PR_FLAGS.BEHIND_BASE]}
              desc="Needs an update or rebase before merging."
            />
          </ul>
        </Block>
      </Card>
    </div>
  );
}
