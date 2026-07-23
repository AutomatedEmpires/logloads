import Image from "next/image"

interface BrandMarkProps {
  className?: string
  priority?: boolean
  size?: number
}

export function BrandMark({ className, priority = false, size = 40 }: BrandMarkProps) {
  const classes = ["brand-mark", className].filter(Boolean).join(" ")

  return (
    <span aria-hidden className={classes} style={{ height: size, width: size }}>
      <Image
        alt=""
        height={size}
        priority={priority}
        sizes={`${size}px`}
        src="/brand/logloads-logo.jpg"
        width={size}
      />
    </span>
  )
}
