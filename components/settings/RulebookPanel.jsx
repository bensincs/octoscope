"use client";
import { useState } from "react";
import ConfigEditor from "@/components/ConfigEditor";
import { useToast } from "@/components/Toast";
import { Panel } from "./primitives";

export default function RulebookPanel({ project, patch, canEdit }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState(null);

  async function save(config) {
    setSaving(true);
    setErrors(null);
    try {
      await patch({ config });
      toast.success("Rulebook saved.");
    } catch (e) {
      if (e.fields) setErrors(e.fields);
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Rulebook"
      blurb="The issue-type hierarchy and allowed labels enforced by audits."
    >
      <fieldset disabled={!canEdit}>
        <ConfigEditor
          config={project.config}
          onSave={save}
          saving={saving}
          errors={errors}
          hideFooter={!canEdit}
        />
      </fieldset>
    </Panel>
  );
}
