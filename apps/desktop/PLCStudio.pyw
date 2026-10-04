"""PLCdesk — spouštěč bez konzole (dvojklik / zástupce na ploše).

Spouští se přes ``pythonw``; ten nemá konzoli, takže případný pád při startu
se zapíše do logu a ukáže v okně, místo aby aplikace tiše zmizela.
"""

import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _run() -> int:
    try:
        from plc_studio.__main__ import main
        return main(sys.argv[1:])
    except Exception:
        detail = traceback.format_exc()
        try:
            from plc_studio.app import state_dir
            log = state_dir() / "plc_studio.log"
            with open(log, "a", encoding="utf-8") as fh:
                fh.write("\n===== start selhal =====\n" + detail)
        except Exception:
            log = None
        try:
            from tkinter import messagebox
            messagebox.showerror("PLCdesk nejde spustit",
                                 detail[-1500:] + (f"\n\nLog: {log}" if log else ""))
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(_run())
