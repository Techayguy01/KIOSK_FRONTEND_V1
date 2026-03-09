/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_ENABLE_WEBSPEECH_FALLBACK?: string;
    readonly VITE_API_BASE_URL?: string;
    readonly VITE_NODE_API_BASE_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
