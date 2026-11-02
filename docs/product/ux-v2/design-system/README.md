# LogLoads design system: source

Reference source for the final Modern Industrial hybrid. The spec is [`../06_DESIGN_SYSTEM.md`](../06_DESIGN_SYSTEM.md).

| File | Purpose | Moves to (DS tickets) |
|---|---|---|
| `tokens.css` | All design tokens: primitive, semantic, component, density, states | `packages/ui/src/tokens/tokens.css` |
| `tokens.ts` | Breakpoints, densities, token names, contrast pairs for tests | `packages/ui/src/tokens/index.ts` |
| `components.css` | Reference styles, one block per component, semantic tokens only | One `*.module.css` per component in `packages/ui/src/**` |
| `component-api.ts` | Props contract for every component | Component `*.tsx` files |
| `data.js` | Fictional prototype content shaped like the contracts view models | Not shipped |
| `app.js` | Prototype components and pages, composition reference | Not shipped |
| `index.html` | Review harness; open it locally next to the files above | Not shipped |

The harness covers nine screens: the six key screens plus the job editor, hauler setup and add-a-landing form. Change a token in `tokens.css` and every screen in `index.html` follows; the harness's "Developer check" demonstrates this. Nothing in this folder is imported by the application.
