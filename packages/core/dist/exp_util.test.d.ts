import { type Project } from "./model.js";
export declare const SAMPLE_DIR: URL;
export declare function sampleNames(): string[];
export declare function loadSampleFile(name: string): Project;
/** Přísná kontrola well-formed XML (párování značek, uvozené atributy, entity); vrací chybu nebo "". */
export declare function xmlProblem(src: string): string;
