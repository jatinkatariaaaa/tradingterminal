"use client"

import { useCallback, useSyncExternalStore } from "react"

/*
 * The trader's favourite symbols, kept in localStorage. One shared store so every
 * screen that shows a star (quotes list, symbol sheet, desktop watchlist) stays in step.
 */
const KEY = "tpp_watchlist"
const EMPTY: string[] = []
let favorites: string[] = EMPTY
let loaded = false
const listeners = new Set<() => void>()

function load() {
  if (loaded || typeof window === "undefined") return
  loaded = true
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) favorites = parsed.filter((s): s is string => typeof s === "string")
  } catch {
    // storage blocked: favourites just won't persist
  }
}

function subscribe(fn: () => void) {
  load()
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const getSnapshot = () => {
  load()
  return favorites
}
const getServerSnapshot = () => EMPTY

/** True when the trader saved favourites in an earlier visit (read once, on the client). */
export function hasSavedFavorites(): boolean {
  load()
  return favorites.length > 0
}

export function useWatchlist() {
  const favs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const toggleFavorite = useCallback((symbol: string) => {
    favorites = favorites.includes(symbol) ? favorites.filter((s) => s !== symbol) : [...favorites, symbol]
    try {
      window.localStorage.setItem(KEY, JSON.stringify(favorites))
    } catch {
      // ignore
    }
    listeners.forEach((l) => l())
  }, [])

  const isFavorite = useCallback((symbol: string) => favs.includes(symbol), [favs])

  return { favorites: favs, toggleFavorite, isFavorite }
}
