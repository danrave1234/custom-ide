import { useEffect, useMemo, useRef, useState } from "react";

export interface CommandItem {
  id: string;
  label: string;
  detail?: string;
  group: string;
  keywords?: string;
  action: () => void;
}

interface Props {
  items: CommandItem[];
  onClose: () => void;
}

export default function CommandPalette({ items, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.label} ${item.detail ?? ""} ${item.group} ${item.keywords ?? ""}`
        .toLowerCase()
        .includes(needle)
    );
  }, [items, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const run = (item: CommandItem | undefined) => {
    if (!item) return;
    item.action();
    onClose();
  };

  return (
    <div className="palette-layer" onMouseDown={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search-row">
          <span className="palette-search-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              }
              if (event.key === "Enter") run(filtered[activeIndex]);
            }}
            placeholder="Search repositories, views, and actions…"
            aria-label="Search commands"
            aria-controls="command-results"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-results" id="command-results" role="listbox">
          {filtered.map((item, index) => (
            <button
              key={item.id}
              className={`palette-item ${index === activeIndex ? "active" : ""}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => run(item)}
            >
              <span className="palette-item-main">
                <span>{item.label}</span>
                {item.detail && <small>{item.detail}</small>}
              </span>
              <span className="palette-group">{item.group}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="palette-empty">No matching commands</div>}
        </div>
        <div className="palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> select</span>
        </div>
      </div>
    </div>
  );
}