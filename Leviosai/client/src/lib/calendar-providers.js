/** Map Connect Tech integration ids → calendar API provider ids */
export function providerFromIntegrationId(id) {
  if (id === "google_calendar" || id === "google") return "google";
  if (id === "outlook") return "outlook";
  return null;
}
