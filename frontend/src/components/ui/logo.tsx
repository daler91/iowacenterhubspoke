import * as React from "react"

import { cn } from "@/lib/utils"

interface LogoProps extends React.SVGAttributes<SVGSVGElement> {
  className?: string
  title?: string
}

export const Logo = React.forwardRef<SVGSVGElement, LogoProps>(
  ({ className, title = "HubSpoke", ...props }, ref) => {
    const hidden = props["aria-hidden"] === true || props["aria-hidden"] === "true"
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className={cn("size-6", className)}
        {...props}
      >
        {hidden ? null : <title>{title}</title>}
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75">
        <path d="M 2.5 16.5 A 10.5 10.5 0 0 1 20.5 6.5" opacity="0.32" />
        <line x1="12" y1="12" x2="21" y2="5" opacity="0.7" />
        <line x1="12" y1="12" x2="22" y2="11.5" opacity="0.7" />
        <line x1="12" y1="12" x2="19" y2="19.5" opacity="0.7" />
        <line x1="12" y1="12" x2="6" y2="20" opacity="0.7" />
        <line x1="12" y1="12" x2="3" y2="13" opacity="0.7" />
        <line x1="12" y1="12" x2="5.5" y2="5.5" opacity="0.7" />
      </g>
      <g fill="currentColor">
        <circle cx="21" cy="5" r="1.6" />
        <circle cx="22" cy="11.5" r="1.2" />
        <circle cx="19" cy="19.5" r="1.4" />
        <circle cx="6" cy="20" r="1.2" />
        <circle cx="3" cy="13" r="1.4" />
        <circle cx="5.5" cy="5.5" r="1.2" />
        <circle cx="12" cy="12" r="1.6" />
      </g>
        <circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.9" />
      </svg>
    )
  },
)
Logo.displayName = "Logo"
