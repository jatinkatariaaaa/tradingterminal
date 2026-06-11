"use client"

import { useState, useEffect } from "react"

export function useWatchlist() {
  const [favorites, setFavorites] = useState<string[]>([])

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tpp_watchlist")
      if (saved) {
        setFavorites(JSON.parse(saved))
      }
    } catch (e) {
      console.error("Failed to load watchlist", e)
    }
  }, [])

  const toggleFavorite = (symbol: string) => {
    setFavorites((prev) => {
      const isFav = prev.includes(symbol)
      const next = isFav ? prev.filter((s) => s !== symbol) : [...prev, symbol]
      try {
        localStorage.setItem("tpp_watchlist", JSON.stringify(next))
      } catch (e) {
        console.error("Failed to save watchlist", e)
      }
      return next
    })
  }

  const isFavorite = (symbol: string) => favorites.includes(symbol)

  return { favorites, toggleFavorite, isFavorite }
}
