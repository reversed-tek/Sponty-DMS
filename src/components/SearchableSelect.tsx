import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export type SearchableSelectOption = {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
};

type SearchableSelectProps = {
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
};

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "Select a record",
  searchPlaceholder = "Search records...",
  emptyMessage = "No matching records found.",
  disabled = false,
}: SearchableSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase();
    if (!normalisedQuery) return options;

    return options.filter((option) =>
      [option.label, option.description ?? "", option.searchText ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalisedQuery),
    );
  }, [options, query]);

  useEffect(() => setActiveIndex(0), [query, open]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function openMenu() {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function choose(option: SearchableSelectOption) {
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      event.preventDefault();
      openMenu();
      return;
    }
    if (!open) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        filteredOptions.length ? Math.min(current + 1, filteredOptions.length - 1) : 0,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(filteredOptions.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filteredOptions[activeIndex];
      if (option) choose(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={rootRef} className={`searchable-select${open ? " open" : ""}${disabled ? " disabled" : ""}`}>
      <div className="searchable-select-control">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          value={open ? query : selectedOption?.label ?? ""}
          placeholder={open ? searchPlaceholder : placeholder}
          onFocus={() => {
            if (!disabled) {
              setOpen(true);
              setQuery("");
            }
          }}
          onClick={() => {
            if (!open) openMenu();
          }}
          onChange={(event) => {
            if (!open) setOpen(true);
            setQuery(event.target.value);
          }}
          onKeyDown={handleKeyDown}
        />

        {value && !disabled ? (
          <button
            type="button"
            className="searchable-select-clear"
            aria-label="Clear selection"
            title="Clear selection"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(true);
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        ) : null}

        <button
          type="button"
          className="searchable-select-toggle"
          aria-label={open ? "Close dropdown" : "Open dropdown"}
          tabIndex={-1}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) {
              setOpen(false);
              setQuery("");
            } else {
              openMenu();
            }
          }}
        >
          ▾
        </button>
      </div>

      {open && (
        <div id={listboxId} className="searchable-select-menu" role="listbox" aria-label="Search results">
          <div className="searchable-select-menu-summary">
            {query
              ? `${filteredOptions.length} matching record${filteredOptions.length === 1 ? "" : "s"}`
              : `${options.length} record${options.length === 1 ? "" : "s"}`}
          </div>
          <div className="searchable-select-options">
            {filteredOptions.map((option, index) => {
              const selected = option.value === value;
              const active = index === activeIndex;
              return (
                <button
                  type="button"
                  key={option.value}
                  role="option"
                  aria-selected={selected}
                  className={`searchable-select-option${selected ? " selected" : ""}${active ? " active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span className="searchable-select-option-label">{option.label}</span>
                  {option.description ? (
                    <span className="searchable-select-option-description">{option.description}</span>
                  ) : null}
                </button>
              );
            })}
            {!filteredOptions.length && (
              <div className="searchable-select-empty">{emptyMessage}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
