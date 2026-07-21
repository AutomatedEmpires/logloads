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
