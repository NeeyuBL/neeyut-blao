import type { TblaoApi } from './index'

declare global {
  interface Window {
    api: TblaoApi
  }
}

export {}
