import type { PlatformKey } from "./model.js";
export interface PlatformRef {
    kind: "product" | "ide" | "st_ref" | "manual" | "import" | "support" | "cz";
    title: string;
    url: string;
    lang: string;
    login?: boolean;
}
/** Ověřené odkazy na dokumentaci platforem (stav k rešerši); `title` je klíč překladu. */
export declare const PLATFORM_REFS: Record<PlatformKey, PlatformRef[]>;
