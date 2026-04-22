// Small helper so every required-field label in the schedule form uses
// the same asterisk. Keeps the marker decorative for screen readers —
// aria-required on the input already announces the requirement.
export function RequiredMark() {
  return <span className="text-danger" aria-hidden="true">*</span>;
}
