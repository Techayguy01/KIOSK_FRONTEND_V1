/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_DEEPGRAM_API_KEY?: string;
    readonly VITE_STT_PROVIDER?: "deepgram" | "webspeech";
    readonly VITE_ENABLE_WEBSPEECH_FALLBACK?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
