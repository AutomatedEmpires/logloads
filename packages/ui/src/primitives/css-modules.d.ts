/** CSS Modules: Next.js compiles them in apps/web; Vitest returns a class-name proxy. */
declare module "*.module.css" {
  const classes: { readonly [className: string]: string }
  export default classes
}
