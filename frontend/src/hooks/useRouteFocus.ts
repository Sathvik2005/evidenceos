import { useEffect, useRef, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Keeps the browser tab title in step with the page heading, and after a navigation moves focus to the new
 * page's heading as soon as it exists. Without this, keyboard and screen-reader users stay on a link that has
 * just disappeared and nothing announces that the page changed. The first page load never steals focus.
 */
export function useRouteFocus(main: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation()
  const first = useRef(true)
  useEffect(() => {
    const root = main.current
    if (!root) return
    let pending = !first.current
    first.current = false
    const sync = () => {
      const heading = root.querySelector('h1')
      if (!heading?.textContent) return
      document.title = `${heading.textContent} · EvidenceOS`
      if (pending) {
        pending = false
        heading.tabIndex = -1
        heading.focus()
      }
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [pathname, main])
}
