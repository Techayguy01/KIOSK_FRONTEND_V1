/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_ENABLE_WEBSPEECH_FALLBACK?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
