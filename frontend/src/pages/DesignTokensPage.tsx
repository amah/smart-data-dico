/**
 * Design tokens showcase — renders the Calm palette, typography, and
 * reskinned DaisyUI primitives so we can eyeball the Phase 1 wiring
 * in both light and dark modes.
 *
 * Visit `/design/tokens`.
 */

const PALETTE: Array<{ group: string; tokens: Array<{ name: string; cssVar: string }> }> = [
  {
    group: "Surface",
    tokens: [
      { name: "bg",          cssVar: "--bg" },
      { name: "bg-raised",   cssVar: "--bg-raised" },
      { name: "bg-subtle",   cssVar: "--bg-subtle" },
      { name: "bg-hover",    cssVar: "--bg-hover" },
      { name: "bg-active",   cssVar: "--bg-active" },
    ],
  },
  {
    group: "Border",
    tokens: [
      { name: "border",        cssVar: "--border" },
      { name: "border-strong", cssVar: "--border-strong" },
      { name: "border-focus",  cssVar: "--border-focus" },
    ],
  },
  {
    group: "Text",
    tokens: [
      { name: "text",        cssVar: "--text" },
      { name: "text-muted",  cssVar: "--text-muted" },
      { name: "text-subtle", cssVar: "--text-subtle" },
    ],
  },
  {
    group: "Accent",
    tokens: [
      { name: "accent",      cssVar: "--accent" },
      { name: "accent-fg",   cssVar: "--accent-fg" },
      { name: "accent-soft", cssVar: "--accent-soft" },
    ],
  },
  {
    group: "Meta (governance split)",
    tokens: [
      { name: "meta-bg",     cssVar: "--meta-bg" },
      { name: "meta-border", cssVar: "--meta-border" },
      { name: "meta-label",  cssVar: "--meta-label" },
    ],
  },
  {
    group: "Status",
    tokens: [
      { name: "success", cssVar: "--success" },
      { name: "warning", cssVar: "--warning" },
      { name: "danger",  cssVar: "--danger" },
    ],
  },
  {
    group: "PII",
    tokens: [
      { name: "pii-direct",   cssVar: "--pii-direct" },
      { name: "pii-indirect", cssVar: "--pii-indirect" },
      { name: "pii-possible", cssVar: "--pii-possible" },
    ],
  },
];

const Swatch = ({ name, cssVar }: { name: string; cssVar: string }) => (
  <div
    className="flex items-center gap-3 p-2 rounded-token-sm border"
    style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}
  >
    <div
      className="w-10 h-10 rounded-token-sm flex-shrink-0"
      style={{
        background: `var(${cssVar})`,
        boxShadow: "inset 0 0 0 1px var(--border)",
      }}
    />
    <div className="min-w-0">
      <div className="mono text-token-xs" style={{ color: "var(--text)" }}>{cssVar}</div>
      <div className="text-token-xs" style={{ color: "var(--text-muted)" }}>{name}</div>
    </div>
  </div>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-8">
    <h2
      className="mb-3 uppercase tracking-wider"
      style={{
        fontSize: "var(--fs-xs)",
        color: "var(--text-subtle)",
        letterSpacing: "0.06em",
        fontWeight: 600,
      }}
    >
      {title}
    </h2>
    {children}
  </section>
);

const DesignTokensPage = () => {
  return (
    <div
      className="p-6 min-h-screen"
      style={{ background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-sans)" }}
    >
      <header className="mb-6">
        <h1 className="mono" style={{ fontSize: "var(--fs-3xl)", fontWeight: 600, letterSpacing: "-0.02em" }}>
          design / tokens
        </h1>
        <p style={{ fontSize: "var(--fs-md)", color: "var(--text-muted)", marginTop: 4 }}>
          Phase 1 wiring check. Toggle the theme from the top bar to verify both states.
        </p>
      </header>

      <Section title="Palette">
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {PALETTE.flatMap(g => g.tokens).map(t => (
            <Swatch key={t.cssVar} {...t} />
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div
          className="p-4 rounded-token-md"
          style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}
        >
          <div style={{ fontSize: "var(--fs-3xl)", fontWeight: 600, letterSpacing: "-0.02em" }}>
            The quick brown fox jumps — 3xl / 28px
          </div>
          <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 600 }}>
            The quick brown fox jumps — 2xl / 20px
          </div>
          <div style={{ fontSize: "var(--fs-xl)" }}>The quick brown fox jumps — xl / 16px</div>
          <div style={{ fontSize: "var(--fs-lg)" }}>The quick brown fox jumps — lg / 14px</div>
          <div style={{ fontSize: "var(--fs-md)" }}>The quick brown fox jumps — md / 13px (body)</div>
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
            The quick brown fox jumps — sm / 12px
          </div>
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
            The quick brown fox jumps — xs / 11px
          </div>
          <div className="mono mt-3" style={{ fontSize: "var(--fs-md)" }}>
            Mono 0123456789 — slashed zero · Order.lineItems[].quantity · uuid
          </div>
        </div>
      </Section>

      <Section title="Standard vs Governance Metadata preview">
        <div
          className="rounded-token-md overflow-hidden"
          style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}
        >
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div
              className="px-3 py-2 uppercase"
              style={{
                fontSize: "var(--fs-xs)",
                color: "var(--text-subtle)",
                letterSpacing: "0.04em",
                background: "var(--bg-subtle)",
                borderBottom: "1px solid var(--border-strong)",
              }}
            >
              Standard
            </div>
            <div
              className="px-3 py-2 uppercase"
              style={{
                fontSize: "var(--fs-xs)",
                color: "var(--meta-label)",
                letterSpacing: "0.04em",
                background: "var(--meta-bg)",
                borderBottom: "1px solid var(--border-strong)",
                borderLeft: "1px dashed var(--meta-border)",
              }}
            >
              Governance metadata
            </div>

            <div className="px-3 py-3">
              <div className="mono" style={{ fontSize: "var(--fs-sm)" }}>customerId</div>
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>uuid · required</div>
            </div>
            <div
              className="px-3 py-3"
              style={{ background: "var(--meta-bg)", borderLeft: "1px dashed var(--meta-border)" }}
            >
              <span
                className="inline-flex items-center gap-1.5"
                style={{ fontSize: "var(--fs-xs)", color: "var(--pii-direct)", fontWeight: 500 }}
              >
                <span
                  style={{
                    width: 6, height: 6, borderRadius: 999, background: "var(--pii-direct)",
                  }}
                />
                Direct PII · 7y retention
              </span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="DaisyUI retheme (buttons / badges / inputs should inherit Calm)">
        <div
          className="p-4 rounded-token-md flex flex-wrap gap-2 items-center"
          style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}
        >
          <button className="btn btn-primary btn-sm">Primary</button>
          <button className="btn btn-secondary btn-sm">Secondary</button>
          <button className="btn btn-ghost btn-sm">Ghost</button>
          <button className="btn btn-success btn-sm">Success</button>
          <button className="btn btn-warning btn-sm">Warning</button>
          <button className="btn btn-error btn-sm">Danger</button>
          <div className="divider divider-horizontal mx-0" />
          <span className="badge badge-primary">primary</span>
          <span className="badge badge-outline">outline</span>
          <span className="badge badge-success">pass</span>
          <span className="badge badge-warning">drift</span>
          <span className="badge badge-error">fail</span>
          <div className="divider divider-horizontal mx-0" />
          <input type="text" placeholder="input" className="input input-sm input-bordered" />
        </div>
      </Section>

      <Section title="Token-aware Tailwind utilities">
        <div className="flex flex-wrap gap-2">
          <div className="px-3 py-2 rounded-token-sm shadow-token-sm bg-surface-raised text-fg border border-line">
            bg-surface-raised · shadow-token-sm
          </div>
          <div className="px-3 py-2 rounded-token-sm bg-surface-subtle text-fg-muted border border-line">
            bg-surface-subtle · text-fg-muted
          </div>
          <div className="px-3 py-2 rounded-token-sm bg-accent-soft text-accent">
            bg-accent-soft · text-accent
          </div>
          <div className="px-3 py-2 rounded-token-sm bg-meta text-meta-label border border-meta-border">
            bg-meta · text-meta-label
          </div>
          <div className="px-3 py-2 rounded-token-sm text-status-success border border-status-success">
            status-success
          </div>
        </div>
      </Section>
    </div>
  );
};

export default DesignTokensPage;
