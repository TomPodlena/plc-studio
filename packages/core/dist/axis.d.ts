/**
 * PLCdesk — servoosa (třída Axis, fáze 2b): konfigurace osy a JEDINÝ model „firmwaru osy“
 * (technologický objekt TIA, osa NC TwinCATu, osa SoftMotion, osa Sysmac, osa Logix) a pohonu.
 *
 * Model běží nad pamětí Float64Array (objekt osy + instance bloků MC) — tutéž funkci volá
 * simulátor návrhu (sim.ts, zrcadlo FB_Axis) i emulátor běhu (emu/compile.ts: bloky MC_* a instrukce
 * Logix jako standardní bloky dialektu nad pamětí přeloženého programu). Obě strany tak počítají
 * pohyb, hotovo, chyby i referování stejně a emulátor porovná jen chování KÓDU FB_Axis.
 *
 * Model (zjednodušení — uvádí ho i dokumentace):
 *  - lichoběžníkový profil (rychlost, zrychlení, zpomalení; ryv se neuvažuje), v poloze = žádaná
 *    poloha dosažena a skutečná v toleranci `posTol`;
 *  - pohon sleduje žádanou polohu přesně; zaseknutá mechanika (zásah frozen) = skutečná poloha
 *    stojí → chyba sledování nad `followMax` → porucha osy (odebrání povolení);
 *  - porucha pohonu a ztráta komunikace = porucha osy hned (ztráta komunikace zruší i referování);
 *  - referování = jízda na referenční polohu výchozí rychlostí, pak „referováno“;
 *  - odebrání povolení (MC_Power Enable = FALSE, MSF) zastaví osu okamžitě (skutečný pohon brzdí
 *    rampou podle StopMode / konfigurace);
 *  - softwarové limity platí jen u referované osy: cíl mimo limity = povel odmítnut, rychlostní
 *    pohyb na limitu = porucha osy.
 * Sémantika bloků podle PLCopen a manuálů výrobců (zdroje u šablon v axis_gen.ts): povel na
 * náběžnou hranu Execute, Done / Error / CommandAborted drží při Execute TRUE, jinak jeden cyklus,
 * nový povel jiné instance přeruší běžící (CommandAborted), opakovaná hrana na běžící instanci se
 * ignoruje (Tc2_MC2), MC_Stop blokuje další povely, dokud je Execute TRUE.
 */
/** Pojmenovaná poloha osy (krok „najet na polohu“ ji může vzít jménem). */
export interface AxisPos {
    name: string;
    pos: number;
}
/**
 * Konfigurace osy = konfigurační list (nastavuje se v IDE: technologický objekt, osa NC, osa
 * SoftMotion, Axis Settings, vlastnosti osy v Motion Group). Jednotky = `Device.unit` (mm / deg).
 */
export interface AxisCfg {
    /** limity dynamiky (rychlost [j/s], zrychlení a zpomalení [j/s²], ryv [j/s³]; 0 = bez ryvu) */
    vMax: number;
    aMax: number;
    dMax: number;
    jerk: number;
    /** výchozí dynamika (TO DynamicDefaults): rychlost; zrychlení / zpomalení = aMax / dMax */
    vDef: number;
    /** softwarové limity (nepovinné) */
    limNeg?: number;
    limPos?: number;
    /** poloha přiřazená v referenčním bodě */
    homePos: number;
    /** okno „v poloze“ a mez chyby sledování */
    posTol: number;
    followMax: number;
    /** rychlost ručního pojezdu */
    jogVel: number;
    /** model simulace: poloha osy po zapnutí (před referováním) */
    startPos: number;
    /** pohon / rozhraní (text do konfiguračního listu), např. „SINAMICS S210, PROFINET tlg. 105“ */
    drive?: string;
    positions: AxisPos[];
}
/** Konfigurace osy s výchozími hodnotami (chybějící pole). */
export declare function axisCfgOf(d: {
    axis?: Partial<AxisCfg>;
}): AxisCfg;
/** Pojmenované polohy osy jako text pro formuláře: „název @ poloha; …“. */
export declare function axisPositionsText(ps: AxisPos[] | undefined): string;
/** Zpět z textu (středníky / řádky „název @ poloha“). Neplatné části a duplicitní názvy přeskočí. */
export declare function parseAxisPositions(s: string): AxisPos[];
/** Jako `parseAxisPositions`, navíc nesrozumitelné části (`bad`) a duplicitní názvy (`dup`, platí první). */
export declare function parseAxisPositionsChecked(s: string): {
    positions: AxisPos[];
    bad: string[];
    dup: string[];
};
/** Jméno objektu osy v kódu (technologický objekt, AXIS_REF, osa SoftMotion / Sysmac, tag osy Logix). */
export declare function axisObjName(dev: {
    name: string;
}): string;
/**
 * Sloty objektu osy. Viditelné členy platformy (ActualPosition, StatusBits.HomingDone, Status.Error…)
 * jsou v emulátoru jen jiná jména týchž slotů (emu/compile.ts `AXIS_MEMBERS`).
 */
export declare const AX: {
    readonly POS: 0;
    readonly VEL: 1;
    readonly SP: 2;
    readonly SPV: 3;
    readonly PWR: 4;
    readonly HOMED: 5;
    readonly ERR: 6;
    readonly ERRID: 7;
    readonly STILL: 8;
    readonly KIND: 9;
    readonly TGT: 10;
    readonly V: 11;
    readonly A: 12;
    readonly D: 13;
    readonly SER: 14;
    readonly NEXT: 15;
    readonly DONE: 16;
    readonly INVEL: 17;
    readonly ERRSER: 18;
    readonly LOCK: 19;
    /** vstupy modelu stroje (zásahy): porucha pohonu, ztráta komunikace, zaseknutá mechanika */
    readonly FAULT: 20;
    readonly LOST: 21;
    readonly STUCK: 22;
    /** viditelné: komunikace v pořádku, chyba sledování, stavové slovo S7-1500 */
    readonly COMMOK: 23;
    readonly FERR: 24;
    readonly SW: 25;
    /** Tc2_MC2: Axis.Status (obnovuje jen ReadStatus) */
    readonly TC_ERR: 26;
    readonly TC_ERRID: 27;
    readonly TC_HOMED: 28;
    readonly TC_STILL: 29;
    /** povolení směrů (Tc2_MC2 Enable_Positive / Enable_Negative) */
    readonly EPOS: 30;
    readonly ENEG: 31;
    /** Logix: adresa MOTION_INSTRUCTION běžícího povelu (−1 = žádná), poslední zpomalení pohybu */
    readonly MI: 32;
    readonly LASTD: 33;
    /** konfigurace */
    readonly VMAX: 34;
    readonly AMAX: 35;
    readonly DMAX: 36;
    readonly VDEF: 37;
    readonly LIMN: 38;
    readonly LIMP: 39;
    readonly HASN: 40;
    readonly HASP: 41;
    readonly HOME: 42;
    readonly TOL: 43;
    readonly FMAX: 44;
    /** vstup modelu stroje: pohon nepřipraven (STO aktivní, bez silového napájení) — regulace nenaběhne, chyba se nehlásí */
    readonly NRDY: 45;
};
export declare const AX_SIZE = 46;
/** Druh povelu osy. */
export declare const KIND: {
    readonly IDLE: 0;
    readonly ABS: 1;
    readonly VEL: 3;
    readonly HALT: 4;
    readonly HOME: 5;
};
/** Příčina poruchy osy (ERRID; v kódu platformy jsou čísla výrobce — tady jen pro model a hlášení). */
export declare const AXERR: {
    readonly DRIVE: 1;
    readonly FOLLOW: 2;
    readonly COMM: 3;
    readonly LIMIT: 4;
};
/** Kód odmítnutí povelu (chyba bloku MC). */
export declare const MCERR: {
    readonly NOTREADY: 101;
    readonly LOCKED: 102;
    readonly PARAM: 103;
    readonly LIMIT: 104;
    readonly NOERROR: 105;
    readonly ACTIVE: 106;
};
/** Počáteční stav objektu osy (konfigurace, poloha po zapnutí, povolení směrů). */
export declare function axisInit(m: Float64Array, a: number, c: AxisCfg): void;
/**
 * Jeden takt modelu osy (po scanu programu, `dt` = perioda scanu): zásahy (porucha pohonu,
 * ztráta komunikace), profil žádané polohy, pohon (sleduje / zaseknutý), chyba sledování, limity.
 */
export declare function axisTick(m: Float64Array, a: number, dt: number): void;
/**
 * Sémantické sloty instance bloku MC: `map` dává offset každého použitého členu v instanci
 * (emulátor: podle jmen členů bloku dialektu; simulátor: `MC_GEN`). Chybějící člen = −1 (blok ho nemá).
 */
export interface McMap {
    axis: number;
    exe: number;
    en: number;
    reg: number;
    drv: number;
    epos: number;
    eneg: number;
    pos: number;
    vel: number;
    acc: number;
    dec: number;
    done: number;
    busy: number;
    abort: number;
    err: number;
    errId: number;
    status: number;
    inVel: number;
    prev: number;
    ser: number;
    st: number;
    shown: number;
}
/** Rozložení instance bloku v simulátoru (jedno pro všechny druhy bloků). */
export declare const MC_GEN: McMap;
export declare const MC_GEN_SIZE = 21;
/** Druh bloku MC. */
export type McKind = "power" | "home" | "abs" | "rel" | "velP" | "velN" | "halt" | "stop" | "reset" | "readStatus";
/**
 * Výklad dynamiky podle platformy (zdroje: manuály v axis_gen.ts `AXIS_SRC`):
 *  s15 S7-1500: < 0 = DynamicDefaults TO, 0 nepřípustné;  s12 S7-1200: zrychlení / zpomalení jen z TO;
 *  tc  Tc2_MC2: Velocity > 0, Acceleration / Deceleration 0 = z konfigurace osy, MC_Halt ≤ 0 = z posledního pohybu;
 *  sm3 / sml / om: hodnoty vždy zadané (FB_Axis dosadí konfiguraci) — Omron 0 = bez rampy.
 */
export type McPlat = "s15" | "s12" | "tc" | "sm3" | "sml" | "om";
/**
 * Jedno volání bloku MC (emulátor: blok dialektu, simulátor: zrcadlo FB_Axis). `b` = instance,
 * `a` = objekt osy (u emulátoru odkaz z členu Axis), `M` = rozložení instance.
 */
export declare function mcCall(kind: McKind, m: Float64Array, b: number, a: number, M: McMap, p: McPlat): void;
/** Bity MOTION_INSTRUCTION (sloty struktury v emulátoru). */
export declare const MI: {
    readonly EN: 0;
    readonly DN: 1;
    readonly ER: 2;
    readonly PC: 3;
    readonly IP: 4;
    readonly ERR: 5;
    readonly EXERR: 6;
};
export declare const MI_SIZE = 7;
/**
 * Provedení instrukce pohybu Logix (MOTION-RM002): v ST se instrukce vykoná při každém
 * průchodu (proto ji kód volá jen na hranu). EN a DN / ER hned; IP běží; PC = proces dokončen
 * (nastaví model osy při dokončení). MAFR při trvající příčině vrací ER (model — příčinu
 * v manuálu „znovu zapůsobí“). Rychlost / zrychlení: jednotky 0 = j/s(²), 1 = % maxima.
 */
export declare function lxExec(name: string, m: Float64Array, a: number, mi: number, args: number[]): void;
