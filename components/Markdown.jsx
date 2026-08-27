"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders project-authored markdown (currently the Welcome page).
//
// SECURITY: react-markdown does not render raw HTML unless you explicitly add
// `rehype-raw`. We deliberately don't. The welcome page is written by project
// admins but read by every member, so a raw-HTML path would let an admin run
// script in a viewer's session. Keep it that way — if you ever need embedded
// HTML, sanitize with `rehype-sanitize` rather than enabling raw output.
//
// Styling is an explicit component map rather than a typography plugin so the
// output matches the app's Primer-ish surface without adding a dependency.
const COMPONENTS = {
  h1: (props) => (
    <h1
      className="mt-6 border-b border-border pb-2 text-2xl font-semibold text-fg first:mt-0"
      {...props}
    />
  ),
  h2: (props) => (
    <h2
      className="mt-6 border-b border-border pb-1.5 text-xl font-semibold text-fg first:mt-0"
      {...props}
    />
  ),
  h3: (props) => (
    <h3 className="mt-5 text-base font-semibold text-fg first:mt-0" {...props} />
  ),
  h4: (props) => (
    <h4 className="mt-4 text-sm font-semibold text-fg first:mt-0" {...props} />
  ),
  p: (props) => <p className="mt-3 text-sm leading-6 text-fg" {...props} />,
  a: (props) => (
    // Project members can link anywhere, so treat these as untrusted outbound
    // links: no referrer, and no window.opener handle back into the app.
    <a
      className="text-accent hover:underline"
      target="_blank"
      rel="noopener noreferrer nofollow"
      {...props}
    />
  ),
  ul: (props) => (
    <ul className="mt-3 list-disc space-y-1 pl-6 text-sm text-fg" {...props} />
  ),
  ol: (props) => (
    <ol className="mt-3 list-decimal space-y-1 pl-6 text-sm text-fg" {...props} />
  ),
  li: (props) => <li className="leading-6" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="mt-3 border-l-4 border-border pl-4 text-sm italic text-muted"
      {...props}
    />
  ),
  code: ({ inline, ...props }) =>
    inline ? (
      <code
        className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[0.85em] text-fg"
        {...props}
      />
    ) : (
      <code className="font-mono text-[0.85em]" {...props} />
    ),
  pre: (props) => (
    <pre
      className="mt-3 overflow-x-auto rounded-md border border-border bg-subtle p-3 text-xs"
      {...props}
    />
  ),
  table: (props) => (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: (props) => (
    <th
      className="border border-border bg-subtle px-3 py-1.5 text-left font-semibold text-fg"
      {...props}
    />
  ),
  td: (props) => <td className="border border-border px-3 py-1.5 text-fg" {...props} />,
  hr: () => <hr className="my-6 border-border" />,
  img: (props) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="mt-3 max-w-full rounded-md border border-border" alt="" {...props} />
  ),
};

export default function Markdown({ children, className = "" }) {
  if (!children?.trim()) return null;
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
