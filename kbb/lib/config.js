// ── Change these if needed ──────────────────────────────
export const APP_NAME = "Wiik og Kælle presenterer PROGNOSESENTERET";
// Admin e-poster (må matche admin_email-sjekken i supabase/schema.sql)
export const ADMIN_EMAILS = ["henrik.kalv@gmail.com", "jakobwii@gmail.com"];
// Bakoverkompatibel: noen steder bruker fortsatt ADMIN_EMAIL (første admin)
export const ADMIN_EMAIL = ADMIN_EMAILS[0];
export function isAdminEmail(email){
  return !!email && ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
export const VIPPS_NUMBER = "99326216";
export const DEFAULT_RULES = { exact_pts: 3, outcome_pts: 1, wrong_pts: 0 };
// ────────────────────────────────────────────────────────
