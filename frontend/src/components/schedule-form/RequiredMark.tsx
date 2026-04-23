// Small helper so every required-field label in the schedule form uses
// the same marker: a red asterisk for sighted users and the word
// "required" for screen readers, delivered inside the <label>. Putting
// "required" in the label itself sidesteps the jsx-a11y rule that
// rejects `aria-required` on button-role controls like the employee
// multi-select, while native inputs/selects can still layer
// aria-required="true" on top without double-announcement on most
// assistive tech.
export function RequiredMark() {
  return (
    <>
      <span className="text-danger-strong" aria-hidden="true">*</span>
      <span className="sr-only">(required)</span>
    </>
  );
}
