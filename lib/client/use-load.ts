"use client"

import { useCallback, useEffect, useState } from "react"
import { api, errMsg } from "./api"

export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState("")
  const reload = useCallback(async () => {
    if (!path) return
    try {
      setData(await api<T>(path))
      setError("")
    } catch (e) {
      setError(errMsg(e))
    }
  }, [path])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    void reload()
  }, [reload])
  return { data, error, reload, setData }
}
