import { useEffect, useState } from "react"

export function useIsMobile(breakpoint: number = 768): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(false)

  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < breakpoint)
    }

    // Check on mount
    checkIsMobile()

    // Listen for resize
    window.addEventListener("resize", checkIsMobile)
    return () => window.removeEventListener("resize", checkIsMobile)
  }, [breakpoint])

  return isMobile
}
