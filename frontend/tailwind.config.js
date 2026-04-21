import daisyui from "daisyui";

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Namespaced design tokens — consumed as `bg-surface`, `text-fg-muted`,
      // `border-line-strong`, `text-accent`, `bg-meta`, `text-pii-direct`, etc.
      // Kept separate from DaisyUI's base-100/primary/base-content namespace
      // so both systems can coexist during the migration.
      colors: {
        surface: {
          DEFAULT: "var(--bg)",
          raised:  "var(--bg-raised)",
          subtle:  "var(--bg-subtle)",
          hover:   "var(--bg-hover)",
          active:  "var(--bg-active)",
        },
        fg: {
          DEFAULT: "var(--text)",
          muted:   "var(--text-muted)",
          subtle:  "var(--text-subtle)",
        },
        line: {
          DEFAULT: "var(--border)",
          strong:  "var(--border-strong)",
          focus:   "var(--border-focus)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          fg:      "var(--accent-fg)",
          soft:    "var(--accent-soft)",
        },
        meta: {
          DEFAULT: "var(--meta-bg)",
          border:  "var(--meta-border)",
          label:   "var(--meta-label)",
        },
        status: {
          success: "var(--success)",
          warning: "var(--warning)",
          danger:  "var(--danger)",
        },
        pii: {
          direct:   "var(--pii-direct)",
          indirect: "var(--pii-indirect)",
          possible: "var(--pii-possible)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        "token-xs":  "var(--fs-xs)",
        "token-sm":  "var(--fs-sm)",
        "token-md":  "var(--fs-md)",
        "token-lg":  "var(--fs-lg)",
        "token-xl":  "var(--fs-xl)",
        "token-2xl": "var(--fs-2xl)",
        "token-3xl": "var(--fs-3xl)",
      },
      borderRadius: {
        "token-sm": "var(--radius-sm)",
        "token-md": "var(--radius-md)",
        "token-lg": "var(--radius-lg)",
      },
      transitionDuration: {
        fast: "var(--dur-fast)",
        med:  "var(--dur-med)",
      },
      boxShadow: {
        "token-sm": "var(--shadow-sm)",
        "token-md": "var(--shadow-md)",
        "token-lg": "var(--shadow-lg)",
      },
      height: {
        "row-comfortable": "var(--row-comfortable)",
        "row-compact":     "var(--row-compact)",
        "row-dense":       "var(--row-dense)",
        row:               "var(--row-height)",
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    // Keep DaisyUI's light/dark as a low-specificity fallback. Our
    // [data-variant="calm"][data-theme=*] overrides in tokens.css win
    // because of higher specificity, so existing .btn / .badge / .card
    // automatically pick up the Calm palette once data-variant is set.
    themes: ["light", "dark"],
  },
};
