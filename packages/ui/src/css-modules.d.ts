/** CSS Modules for packages/ui: Next.js compiles them in apps/web (which declares the same shape); Vitest returns a class-name proxy. */
declare module "*.module.css" {
  const classes: { readonly [className: string]: string }
  export default classes
}
