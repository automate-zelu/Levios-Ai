import { useEffect, useMemo, useRef, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { SDR_TEMPLATE_VARS, tokenForVar } from "./templateVars.js";

/**
 * Text/textarea that inserts template variables via:
 * - typing `@` (filtered mention menu)
 * - chip buttons for every available variable
 * Stores {{key}} tokens under the hood.
 */
export function TemplateVariableField({
  value,
  onChange,
  multiline = false,
  rows = 5,
  placeholder = "",
  ariaLabel,
  maxLength,
}) {
  const ref = useRef(null);
  const [menu, setMenu] = useState(null); // { start, query }

  const filtered = useMemo(() => {
    if (!menu) return [];
    const q = menu.query.toLowerCase();
    return SDR_TEMPLATE_VARS.filter(
      (v) =>
        !q ||
        v.key.includes(q) ||
        v.label.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q)
    );
  }, [menu]);

  const insertToken = (key, replaceFrom = null, replaceTo = null) => {
    const el = ref.current;
    const token = tokenForVar(key);
    const text = value || "";
    let start;
    let end;
    if (replaceFrom != null && replaceTo != null) {
      start = replaceFrom;
      end = replaceTo;
    } else if (el && typeof el.selectionStart === "number") {
      start = el.selectionStart;
      end = el.selectionEnd;
    } else {
      start = text.length;
      end = text.length;
    }
    const next = text.slice(0, start) + token + text.slice(end);
    onChange(next);
    setMenu(null);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const detectMention = (text, caret) => {
    const before = text.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at < 0) return null;
    const between = before.slice(at + 1);
    // Abort if whitespace / newline / another { after @
    if (/[\s{]/.test(between)) return null;
    // Only treat as mention if @ starts a word (start or after whitespace/punct)
    if (at > 0 && /[A-Za-z0-9_]/.test(before[at - 1])) return null;
    return { start: at, query: between };
  };

  const handleChange = (e) => {
    const next = e.target.value;
    const caret = e.target.selectionStart ?? next.length;
    onChange(next);
    setMenu(detectMention(next, caret));
  };

  const handleKeyDown = (e) => {
    if (!menu || filtered.length === 0) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setMenu(null);
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const pick = filtered[0];
      if (pick) {
        const caret = e.target.selectionStart ?? (value || "").length;
        insertToken(pick.key, menu.start, caret);
      }
    }
  };

  useEffect(() => {
    const onDoc = (ev) => {
      if (!ref.current?.contains(ev.target)) setMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const Field = multiline ? "textarea" : "input";

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {SDR_TEMPLATE_VARS.map((v) => (
          <button
            key={v.key}
            type="button"
            title={v.description}
            onClick={() => insertToken(v.key)}
            style={{
              fontSize: 11,
              padding: "4px 9px",
              borderRadius: 6,
              border: `1px solid ${COLORS.border}`,
              background: COLORS.surfaceAlt,
              color: COLORS.text,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            @{v.label}
          </button>
        ))}
      </div>

      <Field
        ref={ref}
        value={value || ""}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || "Type @ to insert a variable…"}
        aria-label={ariaLabel}
        maxLength={maxLength}
        rows={multiline ? rows : undefined}
        style={{
          ...S.input,
          ...(multiline ? { minHeight: 120, resize: "vertical", fontFamily: "inherit" } : {}),
          width: "100%",
        }}
      />

      {menu && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "100%",
            marginTop: 4,
            zIndex: 40,
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: COLORS.textMuted }}>
              No variables match “{menu.query}”
            </div>
          ) : (
            filtered.map((v, i) => (
              <button
                key={v.key}
                type="button"
                role="option"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const caret = ref.current?.selectionStart ?? (value || "").length;
                  insertToken(v.key, menu.start, caret);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  borderBottom: i < filtered.length - 1 ? `1px solid ${COLORS.border}55` : "none",
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontWeight: 650, fontSize: 13 }}>@{v.label}</span>
                  <code style={{ fontSize: 10, color: COLORS.textMuted }}>{tokenForVar(v.key)}</code>
                </div>
                <div style={{ fontSize: 11, color: COLORS.textMuted, lineHeight: 1.4 }}>{v.description}</div>
              </button>
            ))
          )}
        </div>
      )}

      <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 6, lineHeight: 1.45 }}>
        Type <strong style={{ color: COLORS.text }}>@</strong> to pick a variable, or click a chip.
        {" · "}
        Variables map to CRM / workspace fields — you can’t invent new ones without data behind them.
      </div>
    </div>
  );
}
