/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The mock API runs unless this is exactly "false". See ADR-0005. */
  readonly VITE_USE_MOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
