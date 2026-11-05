import type { BookSelection } from "../../api/books";

// The Dashboard's book switch (Marcelo 2026-11-05): All books, or the Manual or Pluto book's own figures.
const choices: { value: BookSelection; label: string }[] = [
  { value: "all", label: "All books" },
  { value: "manual", label: "Manual" },
  { value: "pluto", label: "Pluto" },
];

export function BookSwitch({ selection, onChange }: { selection: BookSelection; onChange: (selection: BookSelection) => void }) {
  return (
    <div className="btn-group" role="group" aria-label="Book">
      {choices.map((choice) => (
        <button key={choice.value} type="button" className={`btn btn-outline-secondary${selection === choice.value ? " active" : ""}`} aria-pressed={selection === choice.value} onClick={() => onChange(choice.value)}>
          {choice.label}
        </button>
      ))}
    </div>
  );
}
