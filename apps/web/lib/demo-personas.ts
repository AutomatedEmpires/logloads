export interface DemoPersona {
  email: string
  label: string
  role: string
  start: string
}

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  {
    email: "hank@northpine.example",
    label: "Hank Hauler",
    role: "Driver",
    start: "Map and active haul"
  },
  {
    email: "dispatch@northpine.example",
    label: "Dana Dispatch",
    role: "Fleet",
    start: "Fleet command"
  },
  {
    email: "cole@summit.example",
    label: "Cole Cedar",
    role: "Host",
    start: "Host command"
  },
  {
    email: "admin@logloads.example",
    label: "LogLoads Admin",
    role: "Admin",
    start: "Admin console"
  },
  {
    email: "emptyfleet@logloads.example",
    label: "Morgan Newfleet",
    role: "Empty fleet",
    start: "Fleet empty states"
  }
] as const

// The five launchers are the curated founder walkthrough. Maya remains
// available for the two-sided reputation journey, but every other seeded
// identity is deliberately unreachable through demo email sign-in.
export const DEMO_EMAIL_SIGN_IN_ALLOWLIST: readonly string[] = [
  ...DEMO_PERSONAS.map((persona) => persona.email),
  "maya@northpine.example"
] as const

const DEMO_EMAIL_SIGN_IN_SET = new Set(DEMO_EMAIL_SIGN_IN_ALLOWLIST)

export function isDemoSignInEmail(email: string): boolean {
  return DEMO_EMAIL_SIGN_IN_SET.has(email.trim().toLowerCase())
}
