# PyInstaller runtime hook: ep UTF-8 + bat VT de rich khong dung legacy Windows console
import sys

for _name in ("stdout", "stderr"):
    _s = getattr(sys, _name, None)
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    import ctypes

    _k = ctypes.windll.kernel32
    for _h in (-11, -12):  # STD_OUTPUT_HANDLE, STD_ERROR_HANDLE
        _handle = _k.GetStdHandle(_h)
        _mode = ctypes.c_uint32()
        if _k.GetConsoleMode(_handle, ctypes.byref(_mode)):
            _k.SetConsoleMode(_handle, _mode.value | 0x0004)  # ENABLE_VIRTUAL_TERMINAL_PROCESSING
except Exception:
    pass
