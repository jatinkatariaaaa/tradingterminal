import * as React from "react"

const MOBILE_BREAKPOINT = 768

/** undefined until mounted, then whether the viewport is phone-sized. */
export function useIsMobileState(): boolean | undefined {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    mql.addEventListener("change", onChange)
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}

export function useIsMobile() {
  return !!useIsMobileState()
}
