export function runPortalAsync(action: Promise<unknown>, label: string): void {
  action.catch((error) => {
    console.warn(`${label} failed`, error);
  });
}
