/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UVP_STATE_MACHINE?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_UVP_FROM_BLOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
