/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UVP_CHAIN_SERVICES_URL?: string;
  readonly VITE_UVP_CONFIG_ID?: string;
  readonly VITE_UVP_CONFIG_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
