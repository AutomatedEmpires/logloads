// Its own module, never the components/v3 barrel or PublicPages: see NotFoundProduct.tsx (#137).
import { NotFoundProduct } from "@/components/v3/NotFoundProduct"

export default function NotFound() {
  return <NotFoundProduct />
}
