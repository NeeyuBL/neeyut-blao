# PyInstaller runtime hook: ep stdout/stderr sang UTF-8 de xuat JSON-lines
# chua ky tu unicode (tieng Viet, ten file...) khong bi mangle tren Windows cp1252.
import sys

for _name in ("stdout", "stderr"):
    _s = getattr(sys, _name, None)
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
