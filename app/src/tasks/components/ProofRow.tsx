export function ProofRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="proof-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
