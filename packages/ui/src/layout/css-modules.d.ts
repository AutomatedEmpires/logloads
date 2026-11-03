// CSS Module typing for packages/ui's own typecheck. Next.js declares the same module shape for apps/web.
declare module "*.module.css" {
  const classes: { readonly [key: string]: string }
  export default classes
}
