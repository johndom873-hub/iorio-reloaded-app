// Beside a card's title when the book switch shows one book (Marcelo 2026-11-11, mockup
// https://claude.ai/artifact/WFT4LzrBsG6yzLD2smKRNu): says the card is filtered too, e.g. "Pluto book".
export function BookTag({ label }: { label: string }) {
  return (
    <span className="text-secondary fw-normal text-nowrap" style={{ fontSize: "0.8rem" }}>
      {label}
    </span>
  );
}
